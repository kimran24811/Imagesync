"""Local CPU speech timestamps. JSON goes to stdout; diagnostics go to stderr."""
import argparse
import json
import os
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--audio', required=True)
parser.add_argument('--model', default='base')
parser.add_argument('--cache', required=True)
parser.add_argument('--language', default=None)
args = parser.parse_args()
try:
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device='cpu', compute_type='int8',
                         cpu_threads=min(4, os.cpu_count() or 2), download_root=args.cache)
    segments, info = model.transcribe(args.audio, word_timestamps=True, beam_size=5,
                                      vad_filter=True, language=args.language or None)
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append({'text': word.word.strip(), 'startMs': round(word.start * 1000),
                          'endMs': round(word.end * 1000)})
    print(json.dumps({'words': words, 'language': info.language}, ensure_ascii=False))
except Exception as error:
    print('Local speech alignment failed: ' + str(error), file=sys.stderr)
    sys.exit(1)
