import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('talkflow/app.js', encoding='utf-8') as f:
    src = f.read()

needle1 = 'btn-stop-record").style.display = "inline-flex"'
needle2 = 'btn-start-record").style.display = "none"'
needle3 = 'track.onended'
needle4 = 'classList.add("recording")'
needle5 = 'sessionDurationSeconds = 0'
needle6 = '_lastDrawTs'

print('Stop button shown:', 'OK' if needle1 in src else 'MISSING')
print('Start button hidden:', 'OK' if needle2 in src else 'MISSING')
print('Mic track.onended:', 'OK' if needle3 in src else 'MISSING')
print('Recording CSS class:', 'OK' if needle4 in src else 'MISSING')
print('Timer reset:', 'OK' if needle5 in src else 'MISSING')
print('30fps throttle:', 'OK' if needle6 in src else 'MISSING')
print('Lines total:', len(src.splitlines()))
