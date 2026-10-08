# Mu, the muon collider mascot

Mu is a Gaussian wave packet who lives on a line. He is born from a flat line, wanders and hops
along it, rides it while it morphs into hills, a loop, a collider ring, a heart or the letter μ,
and smashes into his antimuon twin, which leaves an event display of curling tracks.

When Mu talks, his packet moves with his voice: the speech is low-passed, and that waveform is
added to the packet's own carrier wave, so the talking animation comes straight from the audio.

```
d(s) = g(s) · [ A cos(k s − ω t)  +  G · a_LP(s) ]
```

`g` is the envelope, a Gaussian skewed toward the direction of travel so the packet leans into its motion, `A cos(k s − ω t)` is the packet's high-frequency carrier, and
`a_LP` is the low-passed voice waveform (two cascaded biquads, run in JS on the decoded clip and
read at the playhead) stretched across the packet. The cutoff and the gain `G` are live settings.

## Run

```sh
python3 -m http.server     # voice lines are fetched, so file:// won't do
open http://localhost:8000
```

## Use on a website

```html
<div id="mascot"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<script src="muon.js"></script>
<script>
  const mu = MuonMascot.mount(document.getElementById('mascot'), {
    voiceBase: 'voices/',   // where manifest.json and the mp3s live
    autoBirth: true,        // play the birth on load (without sound until the visitor clicks)
  });
  // mu.birth()  mu.wander()  mu.hop()  mu.ride()  mu.collide()  mu.faces()  mu.stop()
  // mu.emote('happy' | 'surprised' | 'determined' | 'sleepy' | 'sad' | 'smug' | 'dizzy' | 'normal')
  // mu.morph('flat' | 'hills' | 'wave' | 'ring' | 'loop' | 'mu' | 'heart')
  // mu.say('hello')  -- any id from voices/manifest.json
  // mu.set('lowpass', 300); mu.set('speechGain', 1.5)
</script>
```

The canvas is transparent and fills its container's width (aspect 1000:420). Colours come from
CSS custom properties on the container, so the mascot picks up your site's palette:
`--mu-ink`, `--mu-paper` (eye whites), `--mu-minus`, `--mu-plus`, `--mu-font`.

Options for `mount`: `lowpass` (Hz, default 420), `speechGain` (1), `speechWindow` (ms of
speech across the packet, 40), `pitch` (voice playback rate, 1), `carrier` (k, 0.19), `wobble`,
`boilFps` and `inkWeight` (the hand-drawn line), `captions`, `autoBirth`, `background`, `seed`,
`colors` (an object that overrides the CSS properties).

Browsers only play sound after the visitor interacts with the page, so call `say`, `ride` or
`collide` from a click. The first click unlocks audio.

## Voices

The voice lines come from [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (`am_puck` for
μ⁻ and `af_bella` for μ⁺). To add or change lines, edit `LINES` in `tools/synth_voices.py` and
run it. It needs Python 3.10–3.12 and ffmpeg:

```sh
pip install "kokoro>=0.9.4" "transformers>=4.45" soundfile "misaki[en]"
python -m spacy download en_core_web_sm
python tools/synth_voices.py      # writes voices/*.mp3 and voices/manifest.json
```
