This demonstration contains an original synthetic narration generated for SceneSync
using FFmpeg/libflite's `slt` voice. Its exact script and faster-whisper-derived word
timestamps are in timing.json. It uses the four existing repository sample photos,
selected explicitly as curated demonstration assets; it does not certify automatic
vision matching. No user's uploads, reference video, private voice or API key are
included.

Generation:
`ffmpeg -f lavfi -i "flite=text='One idea can change everything. But a clear story makes it matter. Small steps build real progress. Give every word a purpose.':voice=slt" -ar 16000 -ac 1 narration.wav`
