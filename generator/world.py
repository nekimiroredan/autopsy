"""Locations, workers, shifts, and count schedule for the simulator."""

from datetime import datetime, timedelta

START = datetime(2025, 3, 1)
LOCATIONS = ("A-01", "A-02", "B-12", "B-13")
WORKERS = tuple(f"picker-{number:02d}" for number in range(1, 9))
SHIFTS = ("Day", "Swing", "Night")


def ledger_locations(index):
    return LOCATIONS[:2] if index % 4 < 2 else LOCATIONS[2:]


def count_days(days, index):
    cadence = 4 + index // 2 % 3
    return sorted({0, days, *range(cadence, days, cadence)})


def at(day, hour=0, minute=0):
    return START + timedelta(days=day, hours=hour, minutes=minute)
