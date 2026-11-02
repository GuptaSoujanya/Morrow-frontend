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
