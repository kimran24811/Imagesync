These small WAVs are synthetic English speech generated with FFmpeg's libflite
`slt` voice, resampled to 16kHz mono PCM, and padded/trimmed to 2.4 seconds each.
No user media or network service is needed. Each corresponding sentence is spoken
at the beginning of its interval, followed by a pause. The test authors provide
known phrase boundaries; this does not test an automatic speech aligner.

| File | Exact script |
| --- | --- |
| red.wav | Red opens our story. |
| green.wav | Green brings new growth. |
| blue.wav | Blue follows the river. |
| number.wav | Forty two bright ideas. |
| purple.wav | Purple closes our story. |

Generation example:
`ffmpeg -f lavfi -i "flite=text='Red opens our story.':voice=slt" -af "aresample=16000,apad,atrim=duration=2.4" -ac 1 red.wav`
