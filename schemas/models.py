"""Canonical ledger and evidence contracts."""
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schemas.preflight import PreflightReport  # noqa: F401 — part of the public contract

Cause = Literal[
    "double_scan", "missed_scan", "qty_typo", "unit_mismatch", "item_swap",
    "wrong_location", "miscount", "cutoff_timing", "residual_shrink", "opening_balance",
]
Probability = Annotated[float, Field(ge=0, le=1)]
Tier = Literal[0, 1, 2]


class Contract(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False, populate_by_name=True)


def utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


class Movement(Contract):
    txn_id: str
    ts: datetime
    item: str
    location: str
    qty_delta: float
    event_type: str
    doc_no: str | None = None
    worker: str | None = None
    shift: str | None = None

    _utc = field_validator("ts")(utc)


class Count(Contract):
    count_id: str
    count_ts: datetime
    item: str
    location: str
    counted_qty: float

    _utc = field_validator("count_ts")(utc)


class ItemMaster(Contract):
    item: str
    unit_cost: Annotated[float, Field(ge=0)] | None = None
    pack_size: Annotated[float, Field(gt=0)] | None = None
    similar_group: str | None = None
    location_zone: str | None = None


class EditOp(Contract):
    op: Literal["delete", "insert", "set_field", "set_count", "book_loss"]
    txn_id: str | None = None
    count_id: str | None = None
    field: str | None = None
    from_value: str | float | datetime | None = Field(None, alias="from")
    to_value: str | float | datetime | None = Field(None, alias="to")
    txn: Movement | None = None
    qty: float | None = None
    window_id: str | None = None

    @model_validator(mode="after")
    def required_fields(self):
        required = {
            "delete": (self.txn_id,),
            "insert": (self.txn,),
            "set_field": (self.txn_id, self.field, self.from_value, self.to_value),
            "set_count": (self.count_id, self.from_value, self.to_value),
            "book_loss": (self.count_id or self.window_id, self.qty),
        }
        if any(value is None for value in required[self.op]):
            raise ValueError(f"Missing required fields for {self.op}")
        return self


class Repair(Contract):
    ops: list[EditOp] = Field(min_length=1)


class Discrepancy(Contract):
    id: str
    item: str
    location: str
    count_id: str
    prev_count_ts: datetime | None
    count_ts: datetime
    expected: float | None
    counted: float
    gap: float
    anchored: bool
    window_txn_ids: list[str]


class Candidate(Contract):
    cause: Cause
    repair: Repair
    affected: list[tuple[str, str]]
    search_space: int
    competing_matches: int


class Hypothesis(Contract):
    cause: Cause
    confidence: Probability
    repair: Repair
    likelihood_ratio: float
    search_space: int
    competing_matches: int
    evidence: list[str]


class EvidenceObject(Contract):
    id: str
    item: str
    location: str
    window: tuple[datetime | None, datetime]
    tier: Tier
    anchored: bool
    expected: float | None
    counted: float
    gap: float
    value_at_risk: Annotated[float, Field(ge=0)] | None
    abstain: bool
    hypotheses: list[Hypothesis]
    check_id: str | None = None
    suggested_check: str | None = None
    limitations: list[str] = Field(default_factory=list)
    calibrated: bool = False
    cascades: bool = False


class GroundTruthRecord(Contract):
    cause: Cause
    target_id: str
    edit: Repair
    injected_at_step: int
    effects: dict[str, float]
