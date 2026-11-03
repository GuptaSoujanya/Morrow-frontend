import sqlite3
import pytest
from test_server import app, request, dashboard
import commands
from common import company_store
from common.ledger import Ledger
from common.models import JobPosting, Settings
from sites_bot import application_brain
from web.runner import resources_for, conflicts


def test_company_endpoint_and_job_flags_use_same_record(app, monkeypatch):
    db = app[1].parent/'test.db'
    with Ledger(str(db)) as ledger:
        ledger.record_seen(JobPosting('job:1','https://acme.com/jobs/1',title='Engineer',company='Acme'))
    monkeypatch.setattr(dashboard.state, 'database', lambda:db)
    status, body = request(app,'GET','/api/companies')
    assert status==200 and body['counts']['pending']==1
    key=body['rows'][0]['company_id']
    company_store.initialize(db)
    company_store.claim(db,body['rows'][0])
    company_store.finish(db,key,{'fields':{'website':[{'value':'https://acme.com','source':'https://acme.com','evidence':'Acme'}]}})
    status, records=request(app,'GET','/api/records?kind=jobs&days=0')
    assert status==200 and records['rows'][0]['company_research']==dict(id=key,status='partial',researched=True,information_found=True)
    assert request(app,'GET','/api/companies?status=made-up')[0]==400
    assert request(app,'GET','/api/companies?size=1000')[0]==400
    assert request(app,'GET','/api/companies?contact=made-up')[0]==400
    status, contacts=request(app,'GET','/api/companies?contact=missing')
    assert status==200 and contacts['contact_counts']==dict(all=1,email=0,phone=0,missing=1)
    assert len(contacts['rows'])==1
    assert request(app,'GET','/api/companies?contact=email')[1]['rows']==[]


def test_command_is_bounded_and_reserves_same_resource_as_pipeline():
    command=commands.company_research_command({'limit':3,'company':'a'*24,'retry':True})
    assert command.argv[-1]=='--retry' and '--company' in command.argv
    assert conflicts(resources_for(command,'company_research'), resources_for(commands.pipeline_command({'group':'research:companies'}),'pipeline'))
    assert 'browser:main' not in resources_for(command,'company_research')
    for value in [0,51,'$(bad)',1.5,True]:
        with pytest.raises(ValueError):commands.company_research_command({'limit':value})
    with pytest.raises(ValueError):commands.company_research_command({'company':'../private'})


def test_nonowner_cannot_read_company_database_or_application_attempts(app):
    class Accounts:
        def identity(self,handler):return {'id':'other','email':'other@example.com','role':'member','modules':['research','automations']}
        def is_owner(self,handler,user):return False
    app[0].account_bridge=Accounts()
    for endpoint in ('/api/companies','/api/application-agent'):
        assert request(app,'GET',endpoint)[0]==403
    assert request(app,'POST','/api/company-outreach/gmail',{'sender':'a@gmail.com','password':'a'*16})[0]==403


def test_outreach_commands_are_bounded_and_share_draft_and_research_locks():
    command=commands.company_outreach_command({'all':True})
    assert '--all' in command.argv
    resource=resources_for(command,'company_outreach')
    assert conflicts(resource,resources_for(commands.cold_email_command({}),'cold_email'))
    assert conflicts(resource,resources_for(commands.company_research_command({}),'company_research'))
    assert 'browser:main' in resource
    for options in ({'limit':0},{'limit':51},{'company':'../bad'},{'company':'a'*24,'all':True}):
        with pytest.raises(ValueError):commands.company_outreach_command(options)


def test_outreach_selected_company_commands_preserve_exact_ids_and_require_gmail():
    selected = ['a'*24, 'b'*24]
    command = commands.company_outreach_command({'companies':selected, 'require_gmail':True})
    assert [command.argv[index+1] for index, value in enumerate(command.argv) if value=='--company']==selected
    assert '--require-gmail' in command.argv and '--all' not in command.argv
    for selection in ([], 'a'*24, [True], ['../bad'], selected*2, [f'{n:024x}' for n in range(51)]):
        with pytest.raises(ValueError):
            commands.company_outreach_command({'companies':selection})
    for additional in ({'company':'c'*24}, {'all':True}):
        with pytest.raises(ValueError):
            commands.company_outreach_command({'companies':selected, **additional})


def test_exact_roles_are_passed_to_draft_cli_without_allowing_unselected_companies():
    key='a'*24
    command=commands.company_outreach_command({'companies':[key],'roles':{key:'hirist:123'}})
    index=command.argv.index('--role')
    assert command.argv[index+1]==key+':hirist:123'
    for roles in ({'b'*24:'j1'},{key:''},{key:True},{key:'j1\n--all'},['j1']):
        with pytest.raises(ValueError):commands.company_outreach_command({'companies':[key],'roles':roles})


def test_progress_poll_returns_only_the_selected_company_ids(app, monkeypatch):
    db=app[1].parent/'test.db'
    with Ledger(str(db)) as ledger:
        for index in range(3):
            ledger.record_seen(JobPosting(str(index),'https://example.com/jobs/'+str(index),title='Engineer',company='Company '+str(index)))
    monkeypatch.setattr(dashboard.state,'database',lambda:db)
    keys=[row['company_id'] for row in company_store.catalog(db)]
    status,body=request(app,'GET','/api/companies?ids='+','.join(keys[:2]))
    assert status==200 and body['total']==2
    assert {row['company_id'] for row in body['rows']}==set(keys[:2])
    for value in ('bad',','.join(['a'*24]*51)):
        assert request(app,'GET','/api/companies?ids='+value)[0]==400


def test_gmail_setup_is_same_origin_and_does_not_return_password(app,monkeypatch):
    from common import company_outreach
    called=[]
    monkeypatch.setattr(company_outreach,'connect_gmail',lambda settings,sender,password:called.append((sender,password)) or {'connected':True,'sender':sender})
    payload={'sender':'applicant@gmail.com','password':'a'*16}
    assert request(app,'POST','/api/company-outreach/gmail',payload,{'Origin':'https://other.example'})[0]==403
    assert not called
    status,result=request(app,'POST','/api/company-outreach/gmail',payload)
    assert status==200 and result=={'connected':True,'sender':'applicant@gmail.com'}
    assert called==[('applicant@gmail.com','a'*16)]


def test_agent_review_cannot_be_cross_origin_or_release_a_running_attempt(app, monkeypatch):
    settings=Settings(data_dir=str(app[1].parent/'inputs'))
    monkeypatch.setattr('common.config.load_settings', lambda:settings)
    job=JobPosting('j1','https://acme.com/job')
    application_brain.claim(settings,job,job.url)
    status,body=request(app,'GET','/api/application-agent')
    assert status==200 and body['attempts'][0]['state']=='running'
    payload=dict(job_id='j1',outcome='not_sent')
    assert request(app,'POST','/api/application-agent/resolve',payload,{'Origin':'https://other.example'})[0]==403
    assert request(app,'POST','/api/application-agent/resolve',payload)[0]==400
    assert application_brain.blocked(settings,job)=='running'
