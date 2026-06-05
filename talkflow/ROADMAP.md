# TalkFlow Product Roadmap

This document outlines the planned future features and integrations for the TalkFlow coaching platform.

## 🚀 Near Term: Advanced Audio & Integration
* **Dynamic Audio Mixing Control:** Fine-tuned volume sliders to control the relative mix of microphone input versus shared tab audio during Mode 2 sessions.
* **On-the-Fly Word Highlighting:** Real-time visual feedback that highlights filler words as they are spoken, rather than waiting for the session to finish.
* **Whisper Server Model Hot-Reloading:** Ability to change the Whisper model size (tiny, base, small, medium) directly from the settings interface without restarting the python server.

## 📹 Medium Term: Video Coaching & Visual Signals
* **Webcam Feed Capture:** Optional integration to record the candidate's video during self-recording sessions (stored entirely locally).
* **AI Facial Expression Analysis:** Local visual models (e.g. MediaPipe) to assess eye contact, facial tension, and smiling to help candidates build warm and professional video presence.
* **Posture & Gesture Grading:** Tracking hand movements and shoulder posture to give feedback on body language confidence during interviews.

## 🧠 Long Term: Behavioral Signals & Mock Interviewers
* **Speech Rate (WPM) Analytics:** Dynamic graph of words-per-minute speed changes over the session, alerting candidates to excessive speaking speed.
* **Voice Pitch & Tone Variation:** Tone-of-voice assessment to identify monotone delivery or high-pitched nervous signals, coaching the user on vocal variety.
* **Simulated Interactive Mock Interviewer:** An interactive avatar that asks behavioral questions using local Text-To-Speech (TTS) and evaluates candidate answers in a turn-based chat loop.
* **STAR Structure Classifier:** AI validation that candidates organize answers using the Situation, Task, Action, and Result (STAR) framework.
