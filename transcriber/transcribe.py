import sys
import json
import argparse
import time
from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe a WAV file using faster-whisper and emit JSON on stdout."
    )
    parser.add_argument('--file', required=True, help='Path to the 16 kHz mono WAV file')
    parser.add_argument('--model', default='medium', help='Whisper model size (default: medium)')
    parser.add_argument('--language', default='fr', help='Audio language code (default: fr)')
    args = parser.parse_args()

    try:
        start = time.time()

        print(f"[whisper] Chargement modèle {args.model}...", file=sys.stderr, flush=True)
        model = WhisperModel(args.model, device="cpu", compute_type="int8")

        print(f"[whisper] Transcription de {args.file} (langue: {args.language})...", file=sys.stderr, flush=True)
        segments, info = model.transcribe(args.file, language=args.language, beam_size=5)

        # Segments is a lazy generator — consume it fully before measuring duration.
        text = " ".join(seg.text.strip() for seg in segments)
        duration = round(time.time() - start, 2)

        print(f"[whisper] Terminé en {duration}s", file=sys.stderr, flush=True)

        print(json.dumps({
            "text": text,
            "language": info.language,
            "duration": duration,
        }))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
