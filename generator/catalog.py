"""Build an anonymous item catalog and sample order sizes."""

from collections import Counter
from csv import DictReader
from math import exp, log

from schemas.models import ItemMaster


def build_catalog(rng, size=8):
    return [
        ItemMaster(
            item=f"SKU-{500 + index}",
            unit_cost=round(rng.uniform(4, 90), 2),
            pack_size=rng.choice([6, 12, 24]),
            similar_group=f"G-{index // 2 + 1}",
        )
        for index in range(size)
    ]


def order_profile(path):
    """Only frequencies and quantities survive the optional retail input."""
    frequencies = Counter()
    order_sizes = []
    with open(path, encoding="utf-8-sig", newline="") as stream:
        for row in DictReader(stream):
            try:
                quantity = int(row["Quantity"])
                sku = row["StockCode"]
            except (KeyError, ValueError):
                continue
            if quantity > 0 and sku:
                frequencies[sku] += 1
                order_sizes.append(quantity)
    if not order_sizes:
        raise ValueError(
            "Retail data must include StockCode and positive integer Quantity"
        )
    return sorted(frequencies.values(), reverse=True), order_sizes


def size_sample(rng, profile=None):
    return min(
        200,
        max(1, rng.choice(profile) if profile else round(exp(rng.gauss(log(11), 0.7)))),
    )
