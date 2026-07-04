from datetime import datetime, timedelta


def next_run(now: datetime, interval_minutes: int, last_run: datetime | None):
    if last_run is None:
        return now

    candidate = last_run + timedelta(minutes=interval_minutes)
    if candidate < now:
        return now + timedelta(minutes=interval_minutes)
    return candidate


def should_send_digest(users):
    return [u for u in users if u["enabled"] and u.get("email") is not None]

