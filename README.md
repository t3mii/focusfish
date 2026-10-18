# focusfish
Technica 2026 hackathon project: Computer-Vision software to help people regain their focus to get stuff done.

Goals:
1. Start a focus session. The user presses Start, then chooses whether to enable webcam-based movement cues.
2. Block distracting websites. FocusFish starts with a customizable blocklist of social media, gaming, and other distracting sites. Users can remove entries or add their own.
3. Log focus activity. Record session duration, blocked navigation attempts, and basic activity summaries.
4. Use optional computer vision. With consent, estimate head orientation or movement and offer a gentle refocusing prompt when a signal persists.
5. End whenever you want. Stop the session, disable the camera, and review the summary.

focusfish/
├── manifest.json
├── background.js
├── popup.html
├── popup.css
├── popup.js
├── blocked.html
└── vision.js