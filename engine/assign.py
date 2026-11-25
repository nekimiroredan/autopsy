"""Choose a compatible set of replay-verified repairs."""

from collections import defaultdict
from dataclasses import dataclass
from math import log


@dataclass
class Choice:
    candidate: object
    weight: float


def _resources(candidate):
    return {
        ("gap", identifier) for identifier in candidate.affected
    } | candidate.resources


def assign(ranked, *, greedy=False):
    weights = defaultdict(list)
    proposals = {}
    for identifier, rows in ranked.items():
        if not rows:
            continue
        # Assignment may select another valid edit within the same eligible cause.
        cause = rows[0].candidate.cause
        for row in rows:
            candidate = row.candidate
            if candidate.cause != cause:
                continue
            key = candidate.cause, candidate.repair.model_dump_json()
            weights[key].append((identifier, row.probability))
            proposals[key] = candidate

    choices = []
    for key, entries in weights.items():
        candidate = proposals[key]
        if {identifier for identifier, _ in entries} != set(candidate.affected):
            continue
        # Compare repair log score to an explicit abstention baseline. Plain log
        # probability has negative weight and would always return an empty set.
        benefit = sum(log(max(chance, 1e-6) / 0.05) for _, chance in entries)
        if benefit > 0:
            choices.append(Choice(candidate, benefit))
    if not choices:
        return {}
    resources = [_resources(choice.candidate) for choice in choices]
    if greedy:
        chosen, occupied = [], set()
        for index in sorted(range(len(choices)), key=lambda i: (-choices[i].weight, i)):
            if not occupied.intersection(resources[index]):
                occupied.update(resources[index])
                chosen.append(index)
    else:
        chosen = _solve(choices, resources)
    return {
        identifier: choices[index].candidate
        for index in chosen
        for identifier in choices[index].candidate.affected
    }


def _solve(choices, resources):
    uses = defaultdict(list)
    for index, group in enumerate(resources):
        for resource in sorted(group):
            uses[resource].append(index)
    conflicts = [indices for indices in uses.values() if len(indices) > 1]
    if not conflicts:
        return list(range(len(choices)))
    try:
        import pulp
    except ImportError:
        return _solve_highs(choices, conflicts)
    solver = pulp.PULP_CBC_CMD(msg=False, threads=1)
    if not solver.available():
        return _solve_highs(choices, conflicts)
    problem = pulp.LpProblem("warehouse_repair", pulp.LpMaximize)
    variables = [
        pulp.LpVariable(f"repair_{i}", cat="Binary") for i in range(len(choices))
    ]
    problem += pulp.lpSum(
        choice.weight * variable for choice, variable in zip(choices, variables)
    )
    for indices in conflicts:
        problem += pulp.lpSum(variables[i] for i in indices) <= 1
    if problem.solve(solver) != pulp.LpStatusOptimal:
        return _solve_highs(choices, conflicts)
    return [
        index for index, variable in enumerate(variables) if pulp.value(variable) > 0.5
    ]


def _solve_highs(choices, conflicts):
    import numpy as np
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix

    row, column = zip(
        *(
            (number, index)
            for number, indices in enumerate(conflicts)
            for index in indices
        )
    )
    matrix = coo_matrix(
        (np.ones(len(row)), (row, column)), shape=(len(conflicts), len(choices))
    ).tocsc()
    result = milp(
        c=-np.asarray([choice.weight for choice in choices]),
        integrality=np.ones(len(choices)),
        bounds=Bounds(0, 1),
        constraints=LinearConstraint(matrix, 0, 1),
    )
    if not result.success:
        raise RuntimeError(f"Repair assignment failed: {result.message}")
    return np.flatnonzero(result.x > 0.5)
