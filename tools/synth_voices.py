"""Synthesize Mu's voice lines with Kokoro TTS.

    pip install "kokoro>=0.9.4" soundfile
    python tools/synth_voices.py            # writes voices/*.mp3 + voices/manifest.json

Each line names a speaker ("mu-" or "mu+"), a Kokoro voice, and a speed.
The page reads voices/manifest.json, so adding a line here is all it takes.
"""
import json
import pathlib
import subprocess
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

OUT = pathlib.Path(__file__).resolve().parent.parent / "voices"
RATE = 24000

# id, speaker, kokoro voice, speed, text
LINES = [
    ("hello",     "mu-", "am_puck",  1.10, "Hi! I'm Mu, your friendly muon!"),
    ("heavy",     "mu-", "am_puck",  1.10, "I'm two hundred times heavier than an electron. Don't tell anyone."),
    ("wheee",     "mu-", "am_puck",  1.15, "Wheee! Riding the wave!"),
    ("lifetime",  "mu-", "am_puck",  1.15, "I only live two microseconds, so let's go fast!"),
    ("dilation",  "mu-", "am_puck",  1.10, "Good thing time dilation keeps me young."),
    ("ring",      "mu-", "am_puck",  1.10, "Ooh, a ring! Round and round we go!"),
    ("mu",        "mu-", "am_puck",  1.10, "Look, it's me! The letter mu!"),
    ("ready",     "mu-", "am_puck",  1.15, "Ready... set... collide!"),
    ("ouch",      "mu-", "am_puck",  1.05, "Ouch! Did anybody see a Higgs?"),
    ("anti",      "mu+", "af_bella", 1.10, "Hey! I'm the antimuon. Same mass, opposite charge!"),
    ("anti_ready","mu+", "af_bella", 1.15, "Bring it on, little brother!"),
    ("anti_ouch", "mu+", "af_bella", 1.10, "Whoa. Ten teravolts of fun!"),
    ("bye",       "mu-", "am_puck",  1.10, "Bye bye! Come smash with us soon!"),
]


def main() -> None:
    OUT.mkdir(exist_ok=True)
    pipe = KPipeline(lang_code="a")
    manifest = []
    for cid, who, voice, speed, text in LINES:
        chunks = [audio for _, _, audio in pipe(text, voice=voice, speed=speed)]
        audio = np.concatenate([np.asarray(c, dtype=np.float32) for c in chunks])
        audio = audio / max(1e-6, np.abs(audio).max()) * 0.9
        wav = OUT / f"{cid}.wav"
        sf.write(wav, audio, RATE)
        mp3 = OUT / f"{cid}.mp3"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav),
                        "-codec:a", "libmp3lame", "-q:a", "4", str(mp3)], check=True)
        wav.unlink()
        manifest.append({"id": cid, "who": who, "voice": voice, "text": text,
                         "file": mp3.name, "seconds": round(len(audio) / RATE, 2)})
        print(f"{cid:10s} {len(audio)/RATE:5.2f}s  {text}", file=sys.stderr)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
