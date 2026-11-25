"""Run with python -m app.Home."""
import csv
import io
import json

from flask import Flask, g, jsonify, make_response, render_template, request

from app import data_source
from app.i18n import LANGUAGES, is_rtl, match_locale, resolve_locale, strings
from narrator.templates import CAUSE_LABELS, answer, narrate, suggested_check

app = Flask(__name__)
app.config.update(MAX_CONTENT_LENGTH=32 * 1024 * 1024)


@app.before_request
def select_locale():
    g.locale = resolve_locale(request)


@app.after_request
def locale_headers(response):
    if request.endpoint != "static":
        response.headers["Content-Language"] = g.locale
        response.vary.update(("Accept-Language", "Cookie"))
    return response


@app.errorhandler(413)
def upload_too_large(_):
    return jsonify(error="The upload exceeds 32 MB."), 413


@app.get("/")
def home():
    response = make_response(render_template(
        "index.html", locale=g.locale, rtl=is_rtl(g.locale), t=strings(g.locale),
        languages=LANGUAGES,
    ))
    if match_locale(request.args.get("lang")):
        response.set_cookie("autopsy-lang", g.locale, max_age=31536000, samesite="Lax")
    return response


def present_cases(cases, counts):
    count_ids = {(row.item, row.location, row.count_ts): row.count_id for row in counts}
    return [
        dict(case.model_dump(mode="json", by_alias=True, exclude_none=False),
             narrative=narrate(case, g.locale),
             display_check=suggested_check(case, g.locale, count_ids.get(
                 (case.item, case.location, case.window[1])
             )))
        for case in cases
    ]


def sources():
    movements = request.files.get("movements")
    if not movements:
        raise ValueError("Choose a movement log or combined workbook.")
    return movements, request.files.get("counts"), request.files.get("master")


@app.post("/api/inspect")
def inspect():
    from ingest.mapping_cache import suggest
    from ingest.preflight import inspect_bundle

    try:
        frames = inspect_bundle(*sources())
        result = {}
        for kind, frame in frames.items():
            fields, source, digest = suggest(frame, kind, cache_path=app.config.get("AUTOPSY_MAPPING_CACHE"))
            result[kind] = {
                "columns": list(frame.columns),
                "fields": fields,
                "mapping_source": source,
                "mapping_hash": digest,
                "samples": {str(column): [str(value)[:100] for value in frame[column].head(3) if str(value).strip()]
                            for column in frame.columns},
            }
        return jsonify(result)
    except (ValueError, OSError, KeyError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/analyze")
def analyze():
    from ingest.preflight import load_bundle

    try:
        mapping = json.loads(request.form.get("mapping", "{}"))
        if not isinstance(mapping, dict):
            raise TypeError("Invalid column mapping.")
        movements, counts, master, report = load_bundle(
            *sources(), movement_mapping=mapping.get("movement"),
            count_mapping=mapping.get("count"), master_mapping=mapping.get("master"),
            day_first=request.form.get("day_first", "true") == "true",
        )
        if not counts:
            return jsonify(error="Every count row was dropped. Review the count mapping.", report=report.model_dump()), 400
        source = "Partial / adapted public data" if request.form.get("source") == "partial" else "Uploaded data"
        run = data_source.analyze_run(movements, counts, master, report.tier, source)
        run.report = report.model_dump(mode="json")
        return jsonify(run_id=data_source.store(run), report=run.report)
    except (ValueError, OSError, KeyError, TypeError) as error:
        return jsonify(error=str(error)), 400


@app.get("/api/runs/<run_id>")
def load_run(run_id):
    try:
        run = data_source.get_run(run_id)
    except KeyError:
        return jsonify(error="This run is no longer available. Open the demo or upload the files again."), 404
    timestamps = [m.ts for m in run.movements]
    cases = run.evidence
    return jsonify(
        source=run.source, tier=run.tier, transactions=len(run.movements), report=run.report,
        start=min(timestamps).date().isoformat() if timestamps else None,
        end=max(timestamps).date().isoformat() if timestamps else None,
        cases=present_cases(cases, run.counts),
        hotspots=run.hotspots, shift_tiles=data_source.shift_tiles(run),
        feedback=data_source.feedback_enabled(),
    )


@app.get("/api/runs/<run_id>/export")
def export(run_id):
    try:
        cases = data_source.load_evidence(run_id)
    except KeyError:
        return jsonify(error="Run unavailable."), 404

    def spreadsheet_safe(value):
        if isinstance(value, str) and (value.startswith(("\t", "\r", "\n")) or value.lstrip().startswith(("=", "+", "-", "@"))):
            return "'" + value
        return value

    stream = io.StringIO()
    writer = csv.writer(stream)
    headers = ("id", "item", "location", "expected", "counted", "gap", "value_at_risk", "cause", "abstained")
    if request.args.get("headers") == "localized":
        catalog = strings(g.locale)
        headers = [catalog[f"csv.{header}"] for header in headers]
    writer.writerow(headers)
    for case in cases:
        cause = case.hypotheses[0].cause if case.hypotheses and not case.abstain else ""
        writer.writerow(spreadsheet_safe(value) for value in (
            case.id, case.item, case.location, case.expected, case.counted,
            case.gap if case.anchored else None, case.value_at_risk, cause, case.abstain,
        ))
    return app.response_class(stream.getvalue(), mimetype="text/csv",
                              headers={"Content-Disposition": "attachment; filename=autopsy-discrepancies.csv"})


@app.get("/api/runs/<run_id>/transactions")
def transactions(run_id):
    try:
        run = data_source.get_run(run_id)
    except KeyError:
        return jsonify(error="Run unavailable."), 404
    return jsonify([row.model_dump(mode="json", exclude={"worker"}) for row in run.movements])


@app.post("/api/runs/<run_id>/experiment")
def experiment(run_id):
    from demo.experiments import alter
    from engine.replay import EPSILON, Replayer

    try:
        run = data_source.get_run(run_id)
    except KeyError:
        return jsonify(error="Run unavailable."), 404
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Choose a transaction and error type."), 400
    try:
        kind = payload.get("kind")
        destination = payload.get("destination")
        original, movements = alter(run.movements, payload.get("txn_id"), kind, destination)
    except ValueError as error:
        return jsonify(error=str(error)), 400

    keys = {(original.item, original.location)}
    if kind == "wrong_location":
        keys.add((original.item, destination))
    baseline = {row.id: row.gap for row in Replayer(run.movements, run.counts).windows(keys)}
    altered = Replayer(movements, run.counts).windows(keys)
    changed = {row.id for row in altered if row.anchored and abs(row.gap - baseline[row.id]) > EPSILON}
    result = data_source.analyze_run(movements, run.counts, run.master, run.tier, "Error experiment")
    cases = [row for row in result.evidence if row.id in changed]
    return jsonify(
        affected_windows=len(changed),
        detected=bool(cases),
        matched_cause=any(not row.abstain and row.hypotheses and row.hypotheses[0].cause == kind for row in cases),
        cases=present_cases(cases, run.counts),
    )


def find_case(run_id, case_id):
    try:
        return next((case for case in data_source.load_evidence(run_id) if case.id == case_id), None)
    except KeyError:
        return None


@app.get("/api/runs/<run_id>/cases/<case_id>/replay/<int:index>")
def replay_view(run_id, case_id, index):
    from app.replay_view import compare

    case = find_case(run_id, case_id)
    if case is None or not case.anchored or index >= len(case.hypotheses):
        return jsonify(error="Replay unavailable."), 404
    return jsonify(compare(data_source.get_run(run_id), case, case.hypotheses[index]))


@app.post("/api/runs/<run_id>/cases/<case_id>/feedback")
def feedback(run_id, case_id):
    case = find_case(run_id, case_id)
    if case is None:
        return jsonify(error="Case unavailable."), 404
    if case.abstain or not case.hypotheses or not data_source.feedback_enabled():
        return jsonify(error="Feedback is disabled for this case."), 400
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid feedback."), 400
    correct = payload.get("correct")
    label = payload.get("label")
    if not isinstance(correct, bool) or (
        not correct and (not isinstance(label, str) or label not in ((set(CAUSE_LABELS) - {"opening_balance"}) | {"not sure"}))
    ):
        return jsonify(error="Choose a valid feedback label."), 400
    data_source.submit_feedback(case_id, case.hypotheses[0].cause, correct, label,
                                source=data_source.get_run(run_id).source, location=case.location)
    return jsonify(ok=True)


@app.post("/api/runs/<run_id>/cases/<case_id>/question")
def question(run_id, case_id):
    case = find_case(run_id, case_id)
    if case is None:
        return jsonify(error="Case unavailable."), 404
    payload = request.get_json()
    text = payload.get("question", "") if isinstance(payload, dict) else ""
    if not isinstance(text, str):
        return jsonify(error="Enter a question."), 400
    check = present_cases([case], data_source.get_run(run_id).counts)[0]["display_check"]
    return jsonify(answer=answer(case, text, g.locale, check=check))


@app.get("/api/trust")
def trust():
    return jsonify(data_source.load_trust())


if __name__ == "__main__":
    app.run()
