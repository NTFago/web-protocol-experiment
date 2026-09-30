"""Generate publication-ready three-protocol figures from processed CSV files."""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "processed"
OUTPUT = ROOT / "figures"

SERIES = (
    ("h1", "HTTP/1.1", "#0077BB", "//", "o-"),
    ("h2", "HTTP/2", "#EE7733", "..", "s--"),
    ("h3", "HTTP/3", "#228833", "xx", "^-.")
)
GRID = "#D9DEE3"
TEXT = "#263645"
METRICS = (
    ("Page load", "load_ms"),
    ("Resource span", "resource_completion_span_ms")
)


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
            "legend.fontsize": 7.6,
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


def metric_bars(ax: plt.Axes, runs: list[dict[str, str]], compact: bool = False) -> None:
    x = np.arange(len(METRICS), dtype=float)
    width = 0.23
    offsets = (-width, 0.0, width)
    for offset, (condition, label, color, hatch, _) in zip(offsets, SERIES, strict=True):
        selected = [row for row in runs if row["condition"] == condition and row["valid"] == "true"]
        medians: list[float] = []
        lower: list[float] = []
        upper: list[float] = []
        for _, field in METRICS:
            values = numeric(selected, field)
            q1, median, q3 = np.quantile(values, [0.25, 0.5, 0.75])
            medians.append(float(median))
            lower.append(float(median - q1))
            upper.append(float(q3 - median))
        bars = ax.bar(
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
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                value + 12,
                f"{value:.1f}",
                ha="center",
                va="bottom",
                fontsize=6.4 if compact else 7.2,
            )
    ax.set_ylabel("Duration (ms)")
    ax.set_xticks(x, ["Load", "Resource\nspan"] if compact else [label for label, _ in METRICS])
    ax.set_ylim(0, 510)
    ax.set_axisbelow(True)
    ax.grid(axis="y", color=GRID, linewidth=0.65)


def result_bars(runs: list[dict[str, str]]) -> None:
    fig, ax = plt.subplots(figsize=(7.0, 3.45))
    metric_bars(ax, runs)
    ax.set_title("Median; error bars show IQR", loc="left", fontweight="bold")
    ax.legend(frameon=False, loc="upper right", ncols=3)
    fig.tight_layout()
    save(fig, "paper-main-results")


def block_rounds(blocks: list[dict[str, str]]) -> None:
    valid = [row for row in blocks if row["block_valid"] == "true"]
    block_ids = numeric(valid, "block_id")
    fig, axes = plt.subplots(2, 1, figsize=(7.0, 4.8), sharex=True)
    for ax, (title, field) in zip(axes, METRICS, strict=True):
        for condition, label, color, _, style in SERIES:
            ax.plot(
                block_ids,
                numeric(valid, f"{condition}_{field}"),
                style,
                color=color,
                linewidth=1.05,
                markersize=2.8,
                label=label,
            )
        ax.set_title(title, loc="left", fontweight="bold")
        ax.set_ylabel("Duration (ms)")
        ax.set_ylim(0, 480)
        ax.set_axisbelow(True)
        ax.grid(axis="y", color=GRID, linewidth=0.65)
    axes[0].legend(frameon=False, loc="center right", ncols=3)
    axes[-1].set_xlabel("Experimental block")
    axes[-1].set_xticks([1, 5, 10, 15, 20, 25, 30])
    fig.tight_layout(h_pad=0.9)
    save(fig, "paper-block-rounds")


def combined_results(runs: list[dict[str, str]], blocks: list[dict[str, str]]) -> None:
    valid_blocks = [row for row in blocks if row["block_valid"] == "true"]
    block_ids = numeric(valid_blocks, "block_id")
    fig = plt.figure(figsize=(7.15, 3.9))
    grid = fig.add_gridspec(2, 2, width_ratios=(1.02, 1.38), hspace=0.42, wspace=0.34)
    bars_ax = fig.add_subplot(grid[:, 0])
    metric_bars(bars_ax, runs, compact=True)
    bars_ax.set_title("Median and IQR", loc="left", fontweight="bold")
    line_axes = [fig.add_subplot(grid[index, 1]) for index in range(2)]
    for ax, (title, field) in zip(line_axes, METRICS, strict=True):
        for condition, label, color, _, style in SERIES:
            ax.plot(
                block_ids,
                numeric(valid_blocks, f"{condition}_{field}"),
                style,
                color=color,
                linewidth=1.0,
                markersize=2.4,
                label=label,
            )
        ax.set_title(title, loc="left", fontweight="bold")
        ax.set_ylabel("ms")
        ax.set_ylim(0, 480)
        ax.set_yticks([0, 200, 400])
        ax.set_axisbelow(True)
        ax.grid(axis="y", color=GRID, linewidth=0.65)
    line_axes[0].legend(frameon=False, loc="center right", ncols=3, fontsize=6.8)
    line_axes[0].tick_params(labelbottom=False)
    line_axes[-1].set_xlabel("Experimental block")
    line_axes[-1].set_xticks([1, 5, 10, 15, 20, 25, 30])
    save(fig, "paper-results-combined")


def main() -> None:
    configure_style()
    runs = read_csv(PROCESSED / "runs.csv")
    blocks = read_csv(PROCESSED / "block-differences.csv")
    result_bars(runs)
    block_rounds(blocks)
    combined_results(runs, blocks)
    print(f"Wrote paper figures to {OUTPUT}")


if __name__ == "__main__":
    main()
