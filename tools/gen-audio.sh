#!/usr/bin/env bash
# Regenerates src/audio/*.mp3 (one spoken letter each) with ffmpeg's Flite voice.
# Only needed if you want to change the voice or letters; the files are committed.
# Requires ffmpeg built with --enable-libflite. Voices: slt (female), kal, awb, rms.
set -euo pipefail
cd "$(dirname "$0")/.."
VOICE="${VOICE:-slt}"

# letter:spoken-word (the word is what Flite reads, so the letter name is unambiguous)
for pair in c:see h:aitch k:kay l:ell q:cue r:are s:ess t:tee; do
  letter="${pair%%:*}"; word="${pair#*:}"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "flite=text='${word}':voice=${VOICE}" \
    -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5,apad=pad_dur=0.05" \
    -ar 44100 -ac 1 -c:a libmp3lame -q:a 4 "src/audio/${letter}.mp3"
done
ls -l src/audio
