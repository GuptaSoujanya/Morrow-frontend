"""Score tests use only temporary state and server-shaped results."""
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
import learning_scores as scores

DAY = dt.date(2026, 10, 26)
KEY = 'dsa/arrays/problem-1'


def submit(root, passed=2, total=4, *, key=KEY, day=DAY, identifier=None):
    return scores.record_submission(root, {'problem_key': key, 'title': 'Two Sum', 'language': 'python',
        'passed': passed, 'total': total, **({'submission_id': identifier} if identifier else {})},
        at=f'{day}T12:00:00+05:30')


def test_empty_state_and_drafts_never_award_progress(tmp_path):
    assert scores.get_draft(tmp_path, KEY, 'python')['code'] == ''
    first = scores.save_draft(tmp_path, KEY, 'python', 'print("hello")')
    assert scores.save_draft(tmp_path, KEY, 'python', first['code']) == first
    scores.save_draft(tmp_path, KEY, 'javascript', 'console.log("hello")')
    assert scores.get_draft(tmp_path, KEY, 'python') == first
    result = scores.summary(tmp_path, DAY)
    assert result['today']['score'] == result['totals']['attempts'] == result['totals']['verified_solves'] == 0
    assert len(result['days']) == 14 and result['days'][-1]['date'] == str(DAY)
    assert not any(badge['earned_at'] for badge in result['badges'])


def test_best_per_problem_per_day_and_real_submission_test_counts(tmp_path):
    assert submit(tmp_path)['improvement'] == 50
    assert submit(tmp_path, 1)['improvement'] == 0
    assert submit(tmp_path)['improvement'] == 0
    assert submit(tmp_path, 4)['improvement'] == 50
    assert submit(tmp_path, 4)['improvement'] == 0
    result = scores.summary(tmp_path, DAY)
    assert result['today']['score'] == 100 and result['today']['max_score'] == 100
    assert result['today']['attempts'] == 5
    assert result['today']['passed'] == 13 and result['today']['total'] == 20
    assert result['today']['pass_rate'] == 65 and result['totals']['verified_solves'] == 1
    assert result['badges'][0]['earned_at'] and not result['badges'][1]['earned_at']


def test_multiple_problems_new_day_and_rounding(tmp_path):
    submit(tmp_path, 1, 3)
    submit(tmp_path, 2, 3, key='practice/p-one/q1')
    submit(tmp_path, 3, 3, day=DAY - dt.timedelta(days=1))
    result = scores.summary(tmp_path, DAY)
    assert result['today']['score'] == 99 and result['today']['max_score'] == 200
    assert result['totals']['score'] == 199 and result['totals']['verified_solves'] == 1
    assert result['current_streak'] == result['best_streak'] == 2
    assert scores.summary(tmp_path, DAY - dt.timedelta(days=1))['totals']['attempts'] == 1
    assert result['history'][0]['route'].startswith('#/learning/')


def test_submission_identifier_makes_server_retry_idempotent(tmp_path):
    first = submit(tmp_path, identifier='server-run-1')
    assert submit(tmp_path, identifier='server-run-1', day=DAY + dt.timedelta(days=1)) == first
    assert scores.summary(tmp_path, DAY)['totals']['attempts'] == 1
    with pytest.raises(ValueError, match='different result'):
        submit(tmp_path, 4, identifier='server-run-1')
    assert scores.summary(tmp_path, DAY)['totals']['attempts'] == 1


@pytest.mark.parametrize('passed,total', [(True, 1), (1, True), (-1, 3), (4, 3), (0, 0), (1.5, 4), (1, 10001)])
def test_reject_invalid_or_ungraded_result_counts(tmp_path, passed, total):
    with pytest.raises(ValueError, match='server-verified'):
        submit(tmp_path, passed, total)
    assert scores.summary(tmp_path, DAY)['totals']['attempts'] == 0


@pytest.mark.parametrize('key', ['../../private', 'dsa/../problem-1', 'other/problem-1', 'practice/a/b/c', 'dsa/arrays/problem-0'])
def test_keys_are_local_known_problem_namespaces(tmp_path, key):
    with pytest.raises(ValueError):
        scores.save_draft(tmp_path, key, 'python', 'pass')


def test_unsafe_routes_invalid_language_and_oversized_drafts_are_rejected(tmp_path):
    with pytest.raises(ValueError, match='local learning'):
        scores.record_submission(tmp_path, {'problem_key': KEY, 'passed': 1, 'total': 1, 'language': 'python', 'route': 'https://outside.example'})
    with pytest.raises(ValueError):
        scores.save_draft(tmp_path, KEY, '../../python', '')
    with pytest.raises(ValueError, match='100,000'):
        scores.save_draft(tmp_path, KEY, 'python', 'x' * 100_001)


def test_badges_count_unique_verified_problems_and_real_submission_consistency(tmp_path):
    for index in range(25):
        submit(tmp_path, 4, key=f'dsa/arrays/problem-{index + 1}')
    submit(tmp_path, 4)
    for offset in range(1, 7):
        submit(tmp_path, 0, day=DAY - dt.timedelta(days=offset))
    result = scores.summary(tmp_path, DAY)
    assert result['totals']['verified_solves'] == 25 and result['current_streak'] == 7
    assert all(badge['earned_at'] for badge in result['badges'])
    assert 'Every real submission counts' in result['badges'][-1]['description']
    assert scores.summary(tmp_path, DAY + dt.timedelta(days=1))['current_streak'] == 7
    assert scores.summary(tmp_path, DAY + dt.timedelta(days=2))['current_streak'] == 0
    assert len(result['history']) == 20


@pytest.mark.parametrize('contents', ['{broken', '{"version":99}', '{"version":1,"drafts":{},"submissions":[{}]}'])
def test_corruption_never_resets_saved_file(tmp_path, contents):
    folder = tmp_path / 'user/memory'; folder.mkdir(parents=True)
    path = folder / 'code-practice.json'; path.write_text(contents)
    with pytest.raises(ValueError, match='not been reset'):
        scores.summary(tmp_path)
    assert path.read_text() == contents


def test_concurrent_drafts_and_submissions_do_not_overwrite_each_other(tmp_path):
    def worker(index):
        key = f'dsa/arrays/problem-{index + 1}'
        scores.save_draft(tmp_path, key, 'python', str(index))
        return submit(tmp_path, 4, key=key, identifier=f'run-{index}')
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(worker, range(24)))
    result = scores.summary(tmp_path, DAY)
    assert len(results) == result['totals']['attempts'] == result['totals']['verified_solves'] == 24
    assert result['today']['score'] == 2400
    assert all(scores.get_draft(tmp_path, f'dsa/arrays/problem-{i + 1}', 'python')['code'] == str(i) for i in range(24))
    stored = json.loads((tmp_path / 'user/memory/code-practice.json').read_text())
    assert len(stored['submissions']) == len(stored['drafts']) == 24
