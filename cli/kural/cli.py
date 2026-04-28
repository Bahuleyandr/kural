"""Kural CLI entry point."""

import sys

import click
import httpx
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from .client import DEFAULT_HOST, get_voices, synthesize

err_console = Console(stderr=True)
out_console = Console()


@click.group()
@click.version_option(package_name="kural")
def cli():
    """Kural — privacy-first, offline text-to-speech.

    Synthesize speech locally using the Kokoro TTS engine.
    The backend must be running (default: http://localhost:8000).
    """


@cli.command()
@click.argument("text")
@click.option(
    "--voice", "-v",
    default="af_bella",
    show_default=True,
    help="Voice ID (run `kural voices` for the full list).",
)
@click.option(
    "--speed", "-s",
    default=1.0,
    show_default=True,
    type=click.FloatRange(0.5, 2.0),
    help="Speech speed (0.5–2.0).",
)
@click.option(
    "--output", "-o",
    default=None,
    metavar="FILE",
    help="Write audio to FILE instead of stdout.",
)
@click.option(
    "--format", "fmt",
    default="wav",
    show_default=True,
    type=click.Choice(["wav", "mp3"], case_sensitive=False),
    help="Audio format.",
)
@click.option(
    "--host",
    default=DEFAULT_HOST,
    show_default=True,
    envvar="KURAL_HOST",
    help="Kural backend URL (env: KURAL_HOST).",
)
def speak(text: str, voice: str, speed: float, output: str | None, fmt: str, host: str) -> None:
    """Synthesize TEXT to audio.

    Pass - as TEXT to read from stdin:

      echo "Hello world" | kural speak -
    """
    if text == "-":
        text = sys.stdin.read().strip()
        if not text:
            raise click.UsageError("stdin was empty — nothing to synthesize.")

    is_long = len(text) > 200
    show_progress = is_long and sys.stderr.isatty()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        transient=True,
        disable=not show_progress,
        console=err_console,
    ) as progress:
        progress.add_task(f"Synthesizing {len(text):,} chars with {voice}…", total=None)
        try:
            audio = synthesize(text=text, voice=voice, speed=speed, fmt=fmt, host=host)
        except httpx.ConnectError:
            raise click.ClickException(
                f"Cannot connect to backend at {host}. Is it running?"
            )
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:200]
            raise click.ClickException(f"Backend returned {exc.response.status_code}: {detail}")
        except httpx.TimeoutException:
            raise click.ClickException("Request timed out — text may be too long.")

    if output:
        with open(output, "wb") as fh:
            fh.write(audio)
        err_console.print(f"[green]✓[/green] Saved {len(audio):,} bytes → [bold]{output}[/bold]")
    else:
        sys.stdout.buffer.write(audio)


@cli.command()
@click.option(
    "--host",
    default=DEFAULT_HOST,
    show_default=True,
    envvar="KURAL_HOST",
    help="Kural backend URL (env: KURAL_HOST).",
)
def voices(host: str) -> None:
    """List all available voices."""
    try:
        voice_list = get_voices(host=host)
    except httpx.ConnectError:
        raise click.ClickException(
            f"Cannot connect to backend at {host}. Is it running?"
        )
    except httpx.HTTPStatusError as exc:
        raise click.ClickException(f"Backend returned {exc.response.status_code}.")

    table = Table(title="Kural — Available Voices", show_lines=False, box=None)
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Name")
    table.add_column("Language")
    table.add_column("Gender")
    table.add_column("Description", overflow="fold")

    for v in voice_list:
        table.add_row(
            v.get("id", ""),
            v.get("name", ""),
            v.get("language", ""),
            v.get("gender", ""),
            v.get("description", ""),
        )

    out_console.print(table)
    out_console.print(f"\n[dim]{len(voice_list)} voice(s) available[/dim]")


def main() -> None:
    cli()
