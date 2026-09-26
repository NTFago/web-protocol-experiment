"""Generate publication-ready figures from the processed experiment CSV files."""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "processed"
OUTPUT = ROOT / "figures"

BLUE = "#0077BB"
ORANGE = "#EE7733"
GRID = "#D9DEE3"
TEXT = "#263645"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def numeric(rows: list[dict[str, str]], field: str) -> np.ndarray:
    return np.asarray([float(row[field]) for row in rows if row.get(field)], dtype=float)


def configure_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": ["Arial", "DejaVu Sans"],
            "font.size": 9,
            "axes.labelsize": 9,
            "axes.titlesize": 10,
            "xtick.labelsize": 8,
            "ytick.labelsize": 8,
            "legend.fontsize": 8,
            "figure.dpi": 160,
            "savefig.dpi": 300,
            "savefig.bbox": "tight",
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.edgecolor": TEXT,
            "axes.labelcolor": TEXT,
            "xtick.color": TEXT,
            "ytick.color": TEXT,
            "text.color": TEXT,
        }
    )


def save(fig: plt.Figure, stem: str) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUTPUT / f"{stem}.pdf")
    fig.savefig(OUTPUT / f"{stem}.png")
    plt.close(fig)


def result_bars(runs: list[dict[str, str]]) -> None:
    conditions = {
        "HTTP/1.1": [row for row in runs if row["condition"] == "h1" and row["valid"] == "true"],
        "HTTP/2": [row for row in runs if row["condition"] == "h2" and row["valid"] == "true"],
    }
    metrics = [
        ("Page load", "load_ms"),
        ("Resource span", "resource_completion_span_ms"),
    ]
    x = np.arange(len(metrics), dtype=float)
    width = 0.34
    fig, ax = plt.subplots(figsize=(7.0, 3.45))

    for offset, (label, rows), color, hatch in zip(
        (-width / 2, width / 2), conditions.items(), (BLUE, ORANGE), ("//", ".."), strict=True
    ):
        medians = []
        lower = []
        upper = []
        for _, field in metrics:
            values = numeric(rows, field)
            q1, median, q3 = np.quantile(values, [0.25, 0.5, 0.75])
            medians.append(median)
            lower.append(median - q1)
            upper.append(q3 - median)
        bars = ax.bar(
            x + offset,
            medians,
            width,
            yerr=np.asarray([lower, upper]),
            capsize=4,
            label=label,
            color=color,
            edgecolor="#1D2A35",
            linewidth=0.6,
            hatch=hatch,
            error_kw={"elinewidth": 1.0, "capthick": 1.0},
        )
        for bar, value in zip(bars, medians, strict=True):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                value + 15,
                f"{value:.2f}",
                ha="center",
                va="bottom",
                fontsize=8,
            )

    ax.set_ylabel("Median duration (ms); error bars show IQR")
    ax.set_xticks(x, [label for label, _ in metrics])
    ax.set_ylim(0, 510)
    ax.set_axisbelow(True)
    ax.grid(axis="y", color=GRID, linewidth=0.7)
    ax.legend(frameon=False, loc="upper right", ncols=2)
    fig.tight_layout()
    save(fig, "paper-main-results")


def paired_rounds(pairs: list[dict[str, str]]) -> None:
    valid = [row for row in pairs if row["pair_valid"] == "true"]
    pair_ids = numeric(valid, "pair_id")
    metrics = [
        ("Page load", "h1_load_ms", "h2_load_ms"),
        ("Resource completion span", "h1_resource_completion_span_ms", "h2_resource_completion_span_ms"),
    ]
    fig, axes = plt.subplots(2, 1, figsize=(7.0, 4.7), sharex=True)
    for ax, (title, h1_field, h2_field) in zip(axes, metrics, strict=True):
        h1 = numeric(valid, h1_field)
        h2 = numeric(valid, h2_field)
        ax.plot(pair_ids, h1, "o-", color=BLUE, linewidth=1.2, markersize=3.5, label="HTTP/1.1")
        ax.plot(
            pair_ids,
            h2,
            "s--",
            color=ORANGE,
            linewidth=1.2,
            markersize=3.2,
            label="HTTP/2",
        )
        ax.set_title(title, loc="left", fontweight="bold")
        ax.set_ylabel("Duration (ms)")
        ax.set_ylim(0, 480)
        ax.set_axisbelow(True)
        ax.grid(axis="y", color=GRID, linewidth=0.7)
    axes[0].legend(frameon=False, loc="center right", ncols=2)
    axes[-1].set_xlabel("Paired round")
    axes[-1].set_xticks([1, 5, 10, 15, 20, 25, 30])
    fig.tight_layout(h_pad=0.9)
    save(fig, "paper-paired-rounds")


def combined_results(runs: list[dict[str, str]], pairs: list[dict[str, str]]) -> None:
    valid_runs = [row for row in runs if row["valid"] == "true"]
    valid_pairs = [row for row in pairs if row["pair_valid"] == "true"]
    metrics = [
        ("Page load", "load_ms", "h1_load_ms", "h2_load_ms"),
        (
            "Resource span",
            "resource_completion_span_ms",
            "h1_resource_completion_span_ms",
            "h2_resource_completion_span_ms",
        ),
    ]

    fig = plt.figure(figsize=(7.1, 3.75))
    grid = fig.add_gridspec(2, 2, width_ratios=(0.92, 1.38), hspace=0.42, wspace=0.34)
    bars_ax = fig.add_subplot(grid[:, 0])
    line_axes = [fig.add_subplot(grid[index, 1]) for index in range(2)]

    x = np.arange(len(metrics), dtype=float)
    width = 0.34
    for offset, condition, label, color, hatch in (
        (-width / 2, "h1", "HTTP/1.1", BLUE, "//"),
        (width / 2, "h2", "HTTP/2", ORANGE, ".."),
    ):
        rows = [row for row in valid_runs if row["condition"] == condition]
        medians = []
        lower = []
        upper = []
        for _, field, _, _ in metrics:
            values = numeric(rows, field)
            q1, median, q3 = np.quantile(values, [0.25, 0.5, 0.75])
            medians.append(median)
            lower.append(median - q1)
            upper.append(q3 - median)
        bars = bars_ax.bar(
            x + offset,
            medians,
            width,
            yerr=np.asarray([lower, upper]),
            capsize=3,
            label=label,
            color=color,
            edgecolor="#1D2A35",
            linewidth=0.55,
            hatch=hatch,
            error_kw={"elinewidth": 0.9, "capthick": 0.9},
        )
        for bar, value in zip(bars, medians, strict=True):
            bars_ax.text(
                bar.get_x() + bar.get_width() / 2,
                value + 13,
                f"{value:.1f}",
                ha="center",
                va="bottom",
                fontsize=7.5,
            )

    bars_ax.set_title("Median and IQR", loc="left", fontweight="bold")
    bars_ax.set_ylabel("Duration (ms)")
    bars_ax.set_xticks(x, ["Load", "Resource\nspan"])
    bars_ax.set_ylim(0, 510)
    bars_ax.set_axisbelow(True)
    bars_ax.grid(axis="y", color=GRID, linewidth=0.65)
    pair_ids = numeric(valid_pairs, "pair_id")
    for ax, (title, _, h1_field, h2_field) in zip(line_axes, metrics, strict=True):
        ax.plot(
            pair_ids,
            numeric(valid_pairs, h1_field),
            "o-",
            color=BLUE,
            linewidth=1.05,
            markersize=2.6,
            label="HTTP/1.1",
        )
        ax.plot(
            pair_ids,
            numeric(valid_pairs, h2_field),
            "s--",
            color=ORANGE,
            linewidth=1.05,
            markersize=2.4,
            label="HTTP/2",
        )
        ax.set_title(title, loc="left", fontweight="bold")
        ax.set_ylabel("ms")
        ax.set_ylim(0, 480)
        ax.set_yticks([0, 200, 400])
        ax.set_axisbelow(True)
        ax.grid(axis="y", color=GRID, linewidth=0.65)
    line_axes[0].legend(frameon=False, loc="center right", ncols=2, fontsize=7.5)
    line_axes[0].tick_params(labelbottom=False)
    line_axes[-1].set_xlabel("Paired round")
    line_axes[-1].set_xticks([1, 5, 10, 15, 20, 25, 30])

    save(fig, "paper-results-combined")


def main() -> None:
    configure_style()
    runs = read_csv(PROCESSED / "runs.csv")
    pairs = read_csv(PROCESSED / "paired-differences.csv")
    result_bars(runs)
    paired_rounds(pairs)
    combined_results(runs, pairs)
    print(f"Wrote paper figures to {OUTPUT}")


if __name__ == "__main__":
    main()
