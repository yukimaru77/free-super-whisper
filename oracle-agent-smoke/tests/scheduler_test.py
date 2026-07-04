from datetime import datetime

from src.scheduler import next_run, should_send_digest


def test_next_run_catches_up_from_last_run():
    now = datetime(2026, 6, 24, 12, 0)
    last = datetime(2026, 6, 24, 10, 0)
    assert next_run(now, 30, last) == datetime(2026, 6, 24, 12, 0)


def test_digest_skips_disabled_users():
    users = [
        {"enabled": True, "email": "a@example.com"},
        {"enabled": False, "email": "b@example.com"},
        {"enabled": True},
    ]
    assert should_send_digest(users) == [{"enabled": True, "email": "a@example.com"}]

