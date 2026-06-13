"""Kural CLI entry point."""

import json
import sys
import zipfile
from pathlib import Path, PurePosixPath

import click
import httpx
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from .client import (
    DEFAULT_HOST,
    clone_voice,
    delete_clone,
    export_clones,
    get_voices,
    import_clones,
    list_clones,
    list_model_packs,
    synthesize,
)

err_console = Console(stderr=True)
out_console = Console()


def inspect_project_archive_file(archive_file: str | Path) -> dict:
    """Return a safe summary of a portable .kuralproj archive."""
    archive_path = Path(archive_file)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for name in archive.namelist():
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts:
                    raise click.ClickException(f"Unsafe archive path: {name}")
            try:
                manifest = json.loads(archive.read("manifest.json"))
            except KeyError:
                raise click.ClickException("Project archive is missing manifest.json.")
    except zipfile.BadZipFile:
        raise click.ClickException("Project archive is not a valid zip file.")
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"Project archive manifest is not valid JSON: {exc}")

    project = manifest.get("project") or {}
    assets = manifest.get("assets") or []
    return {
        "archive_file": str(archive_path),
        "schema_version": manifest.get("schemaVersion"),
        "exported_at": manifest.get("exportedAt"),
        "project_id": project.get("id", ""),
        "project_name": project.get("name", ""),
        "source_language": project.get("sourceLanguage", ""),
        "target_language": project.get("targetLanguage", ""),
        "tags": project.get("tags") or [],
        "documents": len(project.get("documents") or []),
        "audio_assets": len(assets),
        "voice_presets": len(project.get("voicePresets") or []),
        "pronunciation_profiles": len(project.get("pronunciationProfiles") or []),
        "dubbing_segments": len(project.get("dubbingSegments") or []),
    }


@click.group()
@click.version_option(package_name="kural")
def cli():
    """Kural — privacy-first, offline text-to-speech.

    Synthesize speech locally using the Kokoro TTS engine, or clone any voice
    from a short audio sample with Chatterbox TTS.
    The backend must be running (default: http://localhost:8000).
    """


# ---------------------------------------------------------------------------
# speak
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("text")
@click.option(
    "--voice", "-v",
    default="af_bella",
    show_default=True,
    help="Kokoro voice ID (run `kural voices list` for the full list).",
)
@click.option(
    "--voice-id",
    default=None,
    metavar="VOICE_ID",
    help="Cloned voice ID (overrides --voice). Run `kural voices list --clones`.",
)
@click.option(
    "--speed", "-s",
    default=1.0,
    show_default=True,
    type=click.FloatRange(0.5, 2.0),
    help="Speech speed (0.5–2.0). Ignored for cloned voices.",
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
    help="Audio format (Kokoro only; cloned voices always return WAV).",
)
@click.option(
    "--host",
    default=DEFAULT_HOST,
    show_default=True,
    envvar="KURAL_HOST",
    help="Kural backend URL (env: KURAL_HOST).",
)
def speak(
    text: str,
    voice: str,
    voice_id: str | None,
    speed: float,
    output: str | None,
    fmt: str,
    host: str,
) -> None:
    """Synthesize TEXT to audio.

    Pass - as TEXT to read from stdin:

      echo "Hello world" | kural speak -

    Use a cloned voice:

      kural speak "Hello" --voice-id <clone-id>
    """
    if text == "-":
        text = sys.stdin.read().strip()
        if not text:
            raise click.UsageError("stdin was empty — nothing to synthesize.")

    label = voice_id or voice
    is_long = len(text) > 200
    show_progress = is_long and sys.stderr.isatty()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        transient=True,
        disable=not show_progress,
        console=err_console,
    ) as progress:
        progress.add_task(f"Synthesizing {len(text):,} chars with {label}…", total=None)
        try:
            audio = synthesize(
                text=text,
                voice=voice,
                speed=speed,
                fmt=fmt,
                host=host,
                voice_id=voice_id,
            )
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


# ---------------------------------------------------------------------------
# voices (group)
# ---------------------------------------------------------------------------

@cli.group(invoke_without_command=True)
@click.option(
    "--host",
    default=DEFAULT_HOST,
    show_default=True,
    envvar="KURAL_HOST",
    help="Kural backend URL (env: KURAL_HOST).",
)
@click.option(
    "--clones", "show_clones",
    is_flag=True,
    default=False,
    help="Also list saved cloned voices.",
)
@click.pass_context
def voices(ctx: click.Context, host: str, show_clones: bool) -> None:
    """List available voices, or manage voice cloning.

    Running without a subcommand lists all Kokoro voices.
    """
    ctx.ensure_object(dict)
    ctx.obj["host"] = host
    if ctx.invoked_subcommand is None:
        _print_voices(host, show_clones=show_clones)


def _print_voices(host: str, show_clones: bool = False) -> None:
    try:
        voice_list = get_voices(host=host)
    except httpx.ConnectError:
        raise click.ClickException(
            f"Cannot connect to backend at {host}. Is it running?"
        )
    except httpx.HTTPStatusError as exc:
        raise click.ClickException(f"Backend returned {exc.response.status_code}.")

    table = Table(title="Kural — Kokoro Voices", show_lines=False, box=None)
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
    out_console.print(f"\n[dim]{len(voice_list)} Kokoro voice(s) available[/dim]")

    if show_clones:
        _print_clones(host)


def _print_clones(host: str) -> None:
    try:
        clone_list = list_clones(host=host)
    except httpx.ConnectError:
        raise click.ClickException(
            f"Cannot connect to backend at {host}. Is it running?"
        )
    except httpx.HTTPStatusError as exc:
        raise click.ClickException(f"Backend returned {exc.response.status_code}.")

    if not clone_list:
        out_console.print("\n[dim]No cloned voices saved yet.[/dim]")
        return

    table = Table(title="\nKural — Cloned Voices", show_lines=False, box=None)
    table.add_column("ID", style="magenta", no_wrap=True)
    table.add_column("Name")
    table.add_column("Duration")
    table.add_column("Created")

    for c in clone_list:
        table.add_row(
            c.get("id", ""),
            c.get("name", ""),
            f"{c.get('duration_s', 0):.1f}s",
            c.get("created_at", "")[:10],
        )

    out_console.print(table)
    out_console.print(f"\n[dim]{len(clone_list)} cloned voice(s)[/dim]")


@voices.command("list")
@click.option(
    "--clones", "show_clones",
    is_flag=True,
    default=False,
    help="Also list saved cloned voices.",
)
@click.pass_context
def voices_list(ctx: click.Context, show_clones: bool) -> None:
    """List all available voices."""
    _print_voices(ctx.obj["host"], show_clones=show_clones)


@voices.command("clone")
@click.argument("audio_file", type=click.Path(exists=True, dir_okay=False))
@click.option(
    "--name", "-n",
    required=True,
    help="Display name for this cloned voice.",
)
@click.option(
    "--consent",
    is_flag=True,
    help="Confirm you have consent to clone and use this voice.",
)
@click.pass_context
def voices_clone(ctx: click.Context, audio_file: str, name: str, consent: bool) -> None:
    """Clone a voice from an audio sample.

    AUDIO_FILE should be a WAV or MP3 file, at least 5 seconds long.

    Example:

      kural voices clone sample.wav --name "My Voice"

    The clone is saved locally and appears in `kural voices --clones` and in
    the web UI. Use the returned ID with `kural speak --voice-id`.
    """
    host = ctx.obj["host"]
    if not consent:
        raise click.UsageError("Pass --consent to confirm you may clone this voice.")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        transient=True,
        console=err_console,
    ) as progress:
        progress.add_task(f"Cloning voice from {audio_file}…", total=None)
        try:
            meta = clone_voice(
                audio_path=audio_file,
                name=name,
                host=host,
                consent_confirmed=True,
            )
        except httpx.ConnectError:
            raise click.ClickException(
                f"Cannot connect to backend at {host}. Is it running?"
            )
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:200]
            raise click.ClickException(f"Backend returned {exc.response.status_code}: {detail}")
        except httpx.TimeoutException:
            raise click.ClickException("Request timed out.")

    err_console.print(f"[green]✓[/green] Voice cloned!")
    table = Table(show_lines=False, box=None)
    table.add_column("Field", style="dim")
    table.add_column("Value", style="cyan")
    table.add_row("ID", meta["id"])
    table.add_row("Name", meta["name"])
    table.add_row("Duration", f"{meta.get('duration_s', 0):.1f}s")
    table.add_row("Created", meta.get("created_at", "")[:19])
    out_console.print(table)
    out_console.print(
        f"\n[dim]Use with:[/dim] kural speak \"Hello\" --voice-id {meta['id']}"
    )


@voices.command("delete")
@click.argument("voice_id")
@click.option("--yes", is_flag=True, help="Skip confirmation prompt.")
@click.pass_context
def voices_delete(ctx: click.Context, voice_id: str, yes: bool) -> None:
    """Delete a cloned voice by ID."""
    host = ctx.obj["host"]
    if not yes:
        click.confirm(f"Delete cloned voice {voice_id}?", abort=True)
    try:
        delete_clone(voice_id=voice_id, host=host)
    except httpx.ConnectError:
        raise click.ClickException(
            f"Cannot connect to backend at {host}. Is it running?"
        )
    except httpx.HTTPStatusError as exc:
        raise click.ClickException(f"Backend returned {exc.response.status_code}.")
    err_console.print(f"[green]✓[/green] Deleted {voice_id}")


@voices.command("export")
@click.argument("output_file", type=click.Path(dir_okay=False))
@click.option(
    "--voice-id",
    "voice_ids",
    multiple=True,
    help="Clone ID to export. Repeat to export multiple. Defaults to all clones.",
)
@click.pass_context
def voices_export(ctx: click.Context, output_file: str, voice_ids: tuple[str, ...]) -> None:
    """Export cloned voices to a portable zip archive."""
    host = ctx.obj["host"]
    try:
        archive = export_clones(host=host, voice_ids=list(voice_ids) or None)
    except httpx.ConnectError:
        raise click.ClickException(
            f"Cannot connect to backend at {host}. Is it running?"
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:200]
        raise click.ClickException(f"Backend returned {exc.response.status_code}: {detail}")

    with open(output_file, "wb") as fh:
        fh.write(archive)
    err_console.print(
        f"[green]✓[/green] Exported {len(archive):,} bytes → [bold]{output_file}[/bold]"
    )


@voices.command("import")
@click.argument("archive_file", type=click.Path(exists=True, dir_okay=False))
@click.pass_context
def voices_import(ctx: click.Context, archive_file: str) -> None:
    """Import cloned voices from a Kural zip archive."""
    host = ctx.obj["host"]
    try:
        imported = import_clones(archive_path=archive_file, host=host)
    except httpx.ConnectError:
        raise click.ClickException(
            f"Cannot connect to backend at {host}. Is it running?"
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:200]
        raise click.ClickException(f"Backend returned {exc.response.status_code}: {detail}")

    err_console.print(f"[green]✓[/green] Imported {len(imported)} cloned voice(s)")
    if imported:
        table = Table(show_lines=False, box=None)
        table.add_column("ID", style="magenta", no_wrap=True)
        table.add_column("Name")
        table.add_column("Duration")
        for meta in imported:
            table.add_row(
                meta.get("id", ""),
                meta.get("name", ""),
                f"{meta.get('duration_s', 0):.1f}s",
            )
        out_console.print(table)


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------

@cli.command("models")
@click.option(
    "--host",
    default=DEFAULT_HOST,
    show_default=True,
    envvar="KURAL_HOST",
    help="Kural backend URL (env: KURAL_HOST).",
)
@click.option(
    "--category",
    type=click.Choice(["all", "tts", "asr", "translation"], case_sensitive=False),
    default="all",
    show_default=True,
    help="Filter model packs by workflow category.",
)
def models(host: str, category: str) -> None:
    """List local model packs and active background jobs.

    This is read-only: install/update/remove actions stay in the desktop app
    and backend API where license prompts and progress UI can be shown.
    """
    try:
        payload = list_model_packs(host=host)
    except httpx.ConnectError:
        raise click.ClickException(
            f"Cannot connect to backend at {host}. Is it running?"
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:200]
        raise click.ClickException(f"Backend returned {exc.response.status_code}: {detail}")

    packs = payload.get("packs", [])
    if category != "all":
        packs = [pack for pack in packs if pack.get("category") == category]

    table = Table(title="Kural — Local Model Packs", show_lines=False, box=None)
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Category")
    table.add_column("Status")
    table.add_column("Version")
    table.add_column("License")
    table.add_column("Path", overflow="fold")

    for pack in packs:
        table.add_row(
            pack.get("id", ""),
            pack.get("category", ""),
            str(pack.get("status", "")).replace("_", " "),
            pack.get("version", ""),
            pack.get("license") or "",
            pack.get("installed_path") or "",
        )

    out_console.print(table)
    out_console.print(f"\n[dim]{len(packs)} model pack(s)[/dim]")

    jobs = payload.get("jobs") or []
    if jobs:
        job_table = Table(title="\nRecent Model Jobs", show_lines=False, box=None)
        job_table.add_column("Kind")
        job_table.add_column("Status")
        job_table.add_column("Progress")
        job_table.add_column("Message", overflow="fold")
        for job in jobs[:5]:
            job_table.add_row(
                job.get("kind", ""),
                job.get("status", ""),
                f"{job.get('progress', 0)}%",
                job.get("error") or job.get("message") or "",
            )
        out_console.print(job_table)


# ---------------------------------------------------------------------------
# projects
# ---------------------------------------------------------------------------

@cli.group("projects")
def projects() -> None:
    """Inspect portable Kural project archives."""


@projects.command("inspect")
@click.argument("archive_file", type=click.Path(exists=True, dir_okay=False))
@click.option("--json", "as_json", is_flag=True, help="Print the summary as JSON.")
def projects_inspect(archive_file: str, as_json: bool) -> None:
    """Inspect a .kuralproj archive without extracting it."""
    summary = inspect_project_archive_file(archive_file)
    if as_json:
        out_console.print_json(data=summary)
        return

    table = Table(title="Kural — Project Archive", show_lines=False, box=None)
    table.add_column("Field", style="dim")
    table.add_column("Value", overflow="fold")
    for key, value in summary.items():
        if isinstance(value, list):
            value = ", ".join(map(str, value)) if value else ""
        table.add_row(key.replace("_", " ").title(), str(value))
    out_console.print(table)


def main() -> None:
    cli()
