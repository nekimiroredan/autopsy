from pydantic import BaseModel, ConfigDict


class PreflightReport(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    tier: int
    coverage: dict[str, float]
    rows_read: dict[str, int]
    rows_kept: dict[str, int]
    rows_dropped: dict[str, int]
    drops: dict[str, int]
    warnings: list[str]
    details: dict[str, int | float]
