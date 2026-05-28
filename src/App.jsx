import { useState, useRef, useEffect, useCallback } from "react";

const CRY_TYPES = {
  hunger: { emoji: "🍼", label: "Hungry", color: "#F97316", bg: "#FFF7ED" },
  tired: { emoji: "😴", label: "Sleepy", color: "#8B5CF6", bg: "#F5F3FF" },
  pain: {
    emoji: "😣",
    label: "Discomfort / Pain",
    color: "#EF4444",
    bg: "#FEF2F2",
  },
  gas: { emoji: "💨", label: "Gas / Tummy", color: "#10B981", bg: "#ECFDF5" },
  boredom: {
    emoji: "🧸",
    label: "Bored / Wants Attention",
    color: "#3B82F6",
    bg: "#EFF6FF",
  },
  overstimulated: {
    emoji: "🌀",
    label: "Overstimulated",
    color: "#EC4899",
    bg: "#FDF2F8",
  },
  unknown: { emoji: "❓", label: "Unclear", color: "#6B7280", bg: "#F9FAFB" },
};

const WaveBar = ({ active, index }) => {
  const height = 8 + Math.sin(index * 1.2) * 12 + Math.random() * 8;
  return (
    <div
      style={{
        width: 3,
        borderRadius: 2,
        background: active ? "#FF6B9D" : "#E2D9F3",
        height: active ? `${height}px` : "6px",
        transition: "height 0.15s ease, background 0.3s",
        animationDelay: `${index * 0.07}s`,
      }}
      className={active ? "wave-bar" : ""}
    />
  );
};

const CircularProgress = ({ value, color }) => {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="#EDE9F6"
        strokeWidth="8"
      />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)" }}
      />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fill={color}
        fontFamily="'Playfair Display', serif"
      >
        {value}%
      </text>
    </svg>
  );
};

export default function BabyCryAnalyzer() {
  const [mode, setMode] = useState("idle"); // idle | recording | processing | result | error
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [waveActive, setWaveActive] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [recording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        analyzeBlob(blob);
      };
      mr.start();
      setRecording(true);
      setElapsed(0);
      setWaveActive(true);
      setMode("recording");
    } catch {
      setErrorMsg(
        "Microphone access denied. Please allow mic access or upload a file.",
      );
      setMode("error");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    setWaveActive(false);
    setMode("idle");
  };

  const handleFileUpload = (file) => {
    if (!file || !file.type.startsWith("audio/")) {
      setErrorMsg(
        "Please upload a valid audio file (mp3, wav, m4a, webm, etc.).",
      );
      setMode("error");
      return;
    }
    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
    setMode("idle");
  };

  const toBase64 = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

  const analyzeBlob = async (blob) => {
    if (!blob) return;
    setMode("processing");
    setResult(null);

    try {
      const b64 = await toBase64(blob);
      const mimeType = blob.type || "audio/webm";

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are an expert infant cry analyzer trained on acoustic patterns of baby cries. 
Analyze the provided audio recording and determine the most likely reason the baby is crying based on cry acoustics, rhythm, pitch, and duration patterns.
 
You MUST respond ONLY with a valid JSON object, no preamble, no markdown fences, like this:
{
  "detected": true,
  "cry_type": "hunger",
  "confidence": 78,
  "secondary": "tired",
  "secondary_confidence": 15,
  "duration_seconds": 12,
  "pitch": "medium-high",
  "rhythm": "rhythmic",
  "intensity": "moderate",
  "summary": "One or two sentence plain-language summary for a parent.",
  "tips": ["Short actionable tip 1", "Short actionable tip 2", "Short actionable tip 3"]
}
 
Valid cry_type values: hunger, tired, pain, gas, boredom, overstimulated, unknown
If no cry is detected, set detected to false and cry_type to "unknown".
confidence is 0-100. Be realistic — rarely above 85.`,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Please analyze this audio recording for baby crying patterns and return your assessment as JSON.",
                },
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: mimeType,
                    data: b64,
                  },
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();
      const text = data.content?.find((c) => c.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
      setMode("result");
    } catch (e) {
      console.error(e);
      setErrorMsg(
        "Analysis failed. The audio may be too short, silent, or in an unsupported format.",
      );
      setMode("error");
    }
  };

  const reset = () => {
    setMode("idle");
    setAudioBlob(null);
    setAudioUrl(null);
    setResult(null);
    setErrorMsg("");
    setElapsed(0);
  };

  const fmt = (s) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const primaryType = result
    ? CRY_TYPES[result.cry_type] || CRY_TYPES.unknown
    : null;
  const secondaryType = result?.secondary ? CRY_TYPES[result.secondary] : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
 
        * { box-sizing: border-box; margin: 0; padding: 0; }
 
        body {
          min-height: 100vh;
          background: #FFF5F9;
          font-family: 'DM Sans', sans-serif;
          overflow-x: hidden;
        }
 
        .blob1 {
          position: fixed; top: -120px; right: -80px;
          width: 420px; height: 420px; border-radius: 50%;
          background: radial-gradient(circle, #FECDD3 0%, #FBB6CE 60%, transparent 100%);
          opacity: 0.45; pointer-events: none; z-index: 0;
        }
        .blob2 {
          position: fixed; bottom: -100px; left: -60px;
          width: 360px; height: 360px; border-radius: 50%;
          background: radial-gradient(circle, #DDD6FE 0%, #C4B5FD 60%, transparent 100%);
          opacity: 0.35; pointer-events: none; z-index: 0;
        }
 
        .app {
          position: relative; z-index: 1;
          min-height: 100vh;
          display: flex; flex-direction: column; align-items: center;
          padding: 36px 16px 60px;
        }
 
        header {
          text-align: center; margin-bottom: 36px;
        }
        .logo { font-size: 40px; margin-bottom: 6px; }
        .title {
          font-family: 'Playfair Display', serif;
          font-size: 2rem; font-weight: 700;
          color: #2D1B4E; line-height: 1.15;
        }
        .subtitle {
          font-size: 0.9rem; color: #9C7AB8; margin-top: 6px; font-weight: 300;
          letter-spacing: 0.02em;
        }
 
        .card {
          background: #FFFFFF;
          border-radius: 24px;
          box-shadow: 0 4px 32px rgba(147,90,180,0.10), 0 1px 4px rgba(0,0,0,0.04);
          padding: 32px;
          width: 100%; max-width: 480px;
          margin-bottom: 20px;
        }
 
        .drop-zone {
          border: 2px dashed #DDD6FE;
          border-radius: 16px;
          padding: 28px 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: ${dragOver ? "#F5F3FF" : "#FAFAFF"};
        }
        .drop-zone:hover { border-color: #A78BFA; background: #F5F3FF; }
        .drop-zone-icon { font-size: 32px; margin-bottom: 8px; }
        .drop-zone-text { font-size: 0.85rem; color: #7C5BB0; }
        .drop-zone-sub { font-size: 0.75rem; color: #B8A0D4; margin-top: 4px; }
 
        .divider {
          display: flex; align-items: center; gap: 12px;
          margin: 20px 0; color: #C4B5FD; font-size: 0.8rem;
        }
        .divider::before, .divider::after {
          content: ""; flex: 1; height: 1px; background: #EDE9F6;
        }
 
        .mic-area {
          display: flex; flex-direction: column; align-items: center; gap: 16px;
        }
 
        .mic-btn {
          width: 80px; height: 80px; border-radius: 50%;
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 32px;
          transition: transform 0.15s, box-shadow 0.15s;
          position: relative;
        }
        .mic-btn.idle {
          background: linear-gradient(135deg, #FF6B9D, #C44DBA);
          box-shadow: 0 6px 24px rgba(255,107,157,0.4);
        }
        .mic-btn.idle:hover { transform: scale(1.05); box-shadow: 0 8px 32px rgba(255,107,157,0.5); }
        .mic-btn.recording {
          background: linear-gradient(135deg, #EF4444, #DC2626);
          box-shadow: 0 6px 24px rgba(239,68,68,0.4);
          animation: pulse-mic 1.4s infinite;
        }
        @keyframes pulse-mic {
          0%, 100% { box-shadow: 0 6px 24px rgba(239,68,68,0.4); }
          50% { box-shadow: 0 6px 40px rgba(239,68,68,0.7), 0 0 0 12px rgba(239,68,68,0.1); }
        }
 
        .wave-container {
          display: flex; align-items: center; gap: 3px;
          height: 40px;
        }
 
        @keyframes wave-anim {
          0%, 100% { height: 6px; }
          50% { height: 28px; }
        }
        .wave-bar { animation: wave-anim 0.7s ease-in-out infinite; }
 
        .timer {
          font-family: 'Playfair Display', serif;
          font-size: 1.1rem; color: #EF4444; font-weight: 600;
          letter-spacing: 0.05em;
        }
 
        .stop-btn {
          background: transparent; border: 2px solid #EF4444;
          color: #EF4444; border-radius: 20px;
          padding: 8px 24px; font-size: 0.85rem; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
          font-family: 'DM Sans', sans-serif;
        }
        .stop-btn:hover { background: #FEF2F2; }
 
        .audio-preview {
          margin-top: 16px;
        }
        .audio-preview audio {
          width: 100%; border-radius: 8px; height: 36px;
        }
        .audio-label {
          font-size: 0.78rem; color: #9C7AB8; margin-bottom: 6px; font-weight: 500;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
 
        .analyze-btn {
          width: 100%; padding: 14px;
          background: linear-gradient(135deg, #FF6B9D, #C44DBA);
          border: none; border-radius: 16px;
          color: white; font-size: 1rem; font-weight: 600;
          cursor: pointer; margin-top: 20px;
          font-family: 'DM Sans', sans-serif;
          transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 4px 16px rgba(196,77,186,0.35);
        }
        .analyze-btn:hover { opacity: 0.92; transform: translateY(-1px); }
        .analyze-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
 
        .processing {
          text-align: center; padding: 12px 0;
        }
        .spinner {
          width: 48px; height: 48px; border-radius: 50%;
          border: 4px solid #EDE9F6;
          border-top-color: #C44DBA;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 16px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .processing-text {
          font-size: 0.9rem; color: #7C5BB0; font-weight: 500;
        }
        .processing-sub {
          font-size: 0.8rem; color: #B8A0D4; margin-top: 4px;
        }
 
        .result-header {
          display: flex; align-items: center; gap: 16px; margin-bottom: 24px;
        }
        .result-emoji {
          font-size: 44px;
          animation: bounce-in 0.5s cubic-bezier(.4,1.6,.5,1) both;
        }
        @keyframes bounce-in {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .result-label {
          font-family: 'Playfair Display', serif;
          font-size: 1.5rem; font-weight: 700; color: #2D1B4E;
        }
        .result-sublabel {
          font-size: 0.82rem; color: #9C7AB8; margin-top: 2px;
        }
 
        .confidence-row {
          display: flex; align-items: center; gap: 20px;
          margin-bottom: 24px;
        }
        .confidence-info { flex: 1; }
        .info-row {
          display: flex; justify-content: space-between;
          padding: 8px 0; border-bottom: 1px solid #F3F0F9;
          font-size: 0.83rem;
        }
        .info-row:last-child { border: none; }
        .info-key { color: #9C7AB8; font-weight: 400; }
        .info-val { color: #2D1B4E; font-weight: 600; text-transform: capitalize; }
 
        .secondary-badge {
          display: inline-flex; align-items: center; gap: 6px;
          border-radius: 20px; padding: 6px 14px;
          font-size: 0.8rem; font-weight: 600; margin-bottom: 20px;
          border: 1.5px solid;
        }
 
        .summary-box {
          background: #FAF7FF;
          border-left: 3px solid #C44DBA;
          border-radius: 0 12px 12px 0;
          padding: 12px 16px;
          font-size: 0.88rem; color: #4B3068;
          line-height: 1.55; margin-bottom: 20px;
        }
 
        .tips-title {
          font-size: 0.78rem; font-weight: 600; color: #9C7AB8;
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: 10px;
        }
        .tip-item {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 9px 0; border-bottom: 1px solid #F3F0F9;
          font-size: 0.85rem; color: #3D2B5E; line-height: 1.4;
        }
        .tip-item:last-child { border: none; }
        .tip-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #FF6B9D; margin-top: 6px; flex-shrink: 0;
        }
 
        .reset-btn {
          width: 100%; padding: 12px;
          background: transparent; border: 2px solid #EDE9F6;
          border-radius: 16px; color: #7C5BB0;
          font-size: 0.9rem; font-weight: 600;
          cursor: pointer; margin-top: 16px;
          font-family: 'DM Sans', sans-serif;
          transition: all 0.15s;
        }
        .reset-btn:hover { background: #FAF7FF; border-color: #C4B5FD; }
 
        .error-box {
          background: #FEF2F2; border-radius: 12px;
          padding: 16px; text-align: center;
        }
        .error-icon { font-size: 28px; margin-bottom: 8px; }
        .error-text { font-size: 0.88rem; color: #B91C1C; }
 
        .disclaimer {
          font-size: 0.72rem; color: #B8A0D4; text-align: center;
          max-width: 380px; line-height: 1.5; margin-top: 8px;
        }
 
        .not-detected {
          text-align: center; padding: 8px 0;
        }
        .not-detected-icon { font-size: 40px; margin-bottom: 8px; }
        .not-detected-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.2rem; color: #4B3068; margin-bottom: 6px;
        }
        .not-detected-text { font-size: 0.85rem; color: #9C7AB8; }
      `}</style>

      <div className="blob1" />
      <div className="blob2" />

      <div className="app">
        <header>
          <div className="logo">👶</div>
          <h1 className="title">Baby Cry Analyzer</h1>
          <p className="subtitle">
            Understand what your baby needs — instantly
          </p>
        </header>

        <div className="card">
          {mode === "idle" && !audioBlob && (
            <>
              <div
                className="drop-zone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFileUpload(e.dataTransfer.files[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="drop-zone-icon">🎵</div>
                <div className="drop-zone-text">
                  Drop an audio file here, or click to browse
                </div>
                <div className="drop-zone-sub">
                  MP3, WAV, M4A, WEBM, OGG supported
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={(e) => handleFileUpload(e.target.files[0])}
              />

              <div className="divider">or record live</div>

              <div className="mic-area">
                <button className="mic-btn idle" onClick={startRecording}>
                  🎙️
                </button>
                <span style={{ fontSize: "0.82rem", color: "#9C7AB8" }}>
                  Tap to start recording
                </span>
              </div>
            </>
          )}

          {mode === "recording" && (
            <div className="mic-area">
              <button className="mic-btn recording" onClick={stopRecording}>
                ⏹️
              </button>
              <span className="timer">{fmt(elapsed)}</span>
              <div className="wave-container">
                {Array.from({ length: 20 }, (_, i) => (
                  <WaveBar key={i} active={true} index={i} />
                ))}
              </div>
              <button className="stop-btn" onClick={stopRecording}>
                Stop Recording
              </button>
            </div>
          )}

          {mode === "idle" && audioBlob && (
            <>
              <div className="audio-preview">
                <div className="audio-label">Audio Ready</div>
                <audio controls src={audioUrl} />
              </div>
              <button
                className="analyze-btn"
                onClick={() => analyzeBlob(audioBlob)}
              >
                🔍 Analyze Cry
              </button>
              <button className="reset-btn" onClick={reset}>
                ↩ Start Over
              </button>
            </>
          )}

          {mode === "processing" && (
            <div className="processing">
              <div className="spinner" />
              <div className="processing-text">Analyzing cry patterns…</div>
              <div className="processing-sub">
                This usually takes a few seconds
              </div>
            </div>
          )}

          {mode === "result" &&
            result &&
            (result.detected === false ? (
              <div className="not-detected">
                <div className="not-detected-icon">🔇</div>
                <div className="not-detected-title">No Baby Cry Detected</div>
                <div className="not-detected-text">
                  The recording doesn't appear to contain a recognizable baby
                  cry. Try a clearer recording with less background noise.
                </div>
                <button className="reset-btn" onClick={reset}>
                  ↩ Try Again
                </button>
              </div>
            ) : (
              <>
                <div className="result-header">
                  <div className="result-emoji">{primaryType?.emoji}</div>
                  <div>
                    <div className="result-label">{primaryType?.label}</div>
                    <div className="result-sublabel">Primary detection</div>
                  </div>
                </div>

                <div className="confidence-row">
                  <CircularProgress
                    value={result.confidence}
                    color={primaryType?.color}
                  />
                  <div className="confidence-info">
                    {[
                      ["Pitch", result.pitch],
                      ["Rhythm", result.rhythm],
                      ["Intensity", result.intensity],
                      result.duration_seconds && [
                        "Duration",
                        `~${result.duration_seconds}s`,
                      ],
                    ]
                      .filter(Boolean)
                      .map(([k, v]) => (
                        <div className="info-row" key={k}>
                          <span className="info-key">{k}</span>
                          <span className="info-val">{v}</span>
                        </div>
                      ))}
                  </div>
                </div>

                {secondaryType && (
                  <div
                    className="secondary-badge"
                    style={{
                      color: secondaryType.color,
                      borderColor: secondaryType.color,
                      background: secondaryType.bg,
                    }}
                  >
                    {secondaryType.emoji} Also possible: {secondaryType.label}
                    <span style={{ fontWeight: 400, opacity: 0.7 }}>
                      ({result.secondary_confidence}%)
                    </span>
                  </div>
                )}

                {result.summary && (
                  <div className="summary-box">{result.summary}</div>
                )}

                {result.tips?.length > 0 && (
                  <>
                    <div className="tips-title">What to try</div>
                    {result.tips.map((tip, i) => (
                      <div className="tip-item" key={i}>
                        <div className="tip-dot" />
                        {tip}
                      </div>
                    ))}
                  </>
                )}

                <button className="reset-btn" onClick={reset}>
                  ↩ Analyze Another
                </button>
              </>
            ))}

          {mode === "error" && (
            <div className="error-box">
              <div className="error-icon">⚠️</div>
              <div className="error-text">{errorMsg}</div>
              <button
                className="reset-btn"
                style={{ marginTop: 12 }}
                onClick={reset}
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        <p className="disclaimer">
          ⚕️ This tool is for informational purposes only and does not replace
          medical advice. If your baby has unusual or persistent crying, consult
          a pediatrician.
        </p>
      </div>
    </>
  );
}
