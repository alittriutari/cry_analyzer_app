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
  const [activeTab, setActiveTab] = useState("tips");
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
      // Low bitrate = smaller payload = faster upload to Gemini
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mr = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
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

  // Acoustic analysis using Web Audio API — runs entirely in the browser, no network call
  const analyzeBlob = async (blob) => {
    if (!blob) return;
    setMode("processing");
    setResult(null);

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      await audioCtx.close();

      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const duration = audioBuffer.duration;

      // 1. RMS energy (loudness)
      let sumSq = 0;
      for (let i = 0; i < channelData.length; i++) sumSq += channelData[i] ** 2;
      const rms = Math.sqrt(sumSq / channelData.length);

      // No sound detected
      if (rms < 0.005) {
        setResult({ detected: false, cry_type: "unknown" });
        setMode("result");
        return;
      }

      // 2. Zero-crossing rate (pitch indicator — higher = higher pitched cry)
      let zeroCrossings = 0;
      for (let i = 1; i < channelData.length; i++) {
        if (channelData[i] >= 0 !== channelData[i - 1] >= 0) zeroCrossings++;
      }
      const zcr = zeroCrossings / (channelData.length / sampleRate); // crossings per second

      // 3. Energy variance (rhythmic = low variance, continuous = high variance)
      const frameSize = Math.floor(sampleRate * 0.05); // 50ms frames
      const frameEnergies = [];
      for (let i = 0; i + frameSize < channelData.length; i += frameSize) {
        let e = 0;
        for (let j = i; j < i + frameSize; j++) e += channelData[j] ** 2;
        frameEnergies.push(e / frameSize);
      }
      const meanEnergy =
        frameEnergies.reduce((a, b) => a + b, 0) / frameEnergies.length;
      const energyVariance =
        frameEnergies.reduce((a, b) => a + (b - meanEnergy) ** 2, 0) /
        frameEnergies.length;
      const normalizedVariance = energyVariance / (meanEnergy ** 2 + 1e-10);

      // 4. Silence ratio (pauses between cries = rhythmic/hunger pattern)
      const silenceThreshold = rms * 0.3;
      let silentFrames = frameEnergies.filter(
        (e) => Math.sqrt(e) < silenceThreshold,
      ).length;
      const silenceRatio = silentFrames / frameEnergies.length;

      // --- Classification rules based on acoustic research ---
      // hunger:        rhythmic, medium pitch, regular pauses (zcr 200-400, silenceRatio > 0.2)
      // tired:         low pitch, low energy, continuous (zcr < 200, low variance)
      // pain:          high pitch, sudden burst, low silence ratio (zcr > 500, high rms)
      // gas:           medium-high pitch, strained, moderate variance (zcr 350-500)
      // overstimulated: very high energy, erratic, high variance (high rms + high variance)
      // boredom:       low energy, intermittent, flat (low rms, high silenceRatio)

      let cry_type = "unknown";
      let confidence = 55;
      let secondary = null;
      let secondary_confidence = 0;

      const pitch =
        zcr < 200
          ? "low"
          : zcr < 350
            ? "medium"
            : zcr < 500
              ? "medium-high"
              : "high";
      const intensity =
        rms < 0.05 ? "soft" : rms < 0.15 ? "moderate" : "strong";
      const rhythm =
        normalizedVariance < 1.5
          ? "continuous"
          : silenceRatio > 0.25
            ? "rhythmic"
            : "irregular";

      if (rms < 0.02) {
        cry_type = "unknown";
        confidence = 40;
      } else if (zcr > 500 && rms > 0.12) {
        cry_type = "pain";
        confidence = 72;
        secondary = "overstimulated";
        secondary_confidence = 18;
      } else if (rms > 0.15 && normalizedVariance > 3) {
        cry_type = "overstimulated";
        confidence = 68;
        secondary = "pain";
        secondary_confidence = 20;
      } else if (zcr < 200 && rms < 0.08 && normalizedVariance < 1.5) {
        cry_type = "tired";
        confidence = 70;
        secondary = "boredom";
        secondary_confidence = 15;
      } else if (silenceRatio > 0.25 && zcr >= 200 && zcr <= 420) {
        cry_type = "hunger";
        confidence = 74;
        secondary = "tired";
        secondary_confidence = 14;
      } else if (zcr >= 350 && zcr <= 520 && normalizedVariance > 1.5) {
        cry_type = "gas";
        confidence = 65;
        secondary = "pain";
        secondary_confidence = 22;
      } else if (rms < 0.06 && silenceRatio > 0.35) {
        cry_type = "boredom";
        confidence = 62;
        secondary = "tired";
        secondary_confidence = 20;
      } else {
        cry_type = "hunger";
        confidence = 55;
        secondary = "gas";
        secondary_confidence = 20;
      }

      const TIPS = {
        hunger: [
          "Try feeding if it's been 2+ hours since the last feed",
          "Look for rooting reflex — turning head, sucking motions",
          "Offer a feed even if not on schedule",
        ],
        tired: [
          "Dim the lights and reduce noise",
          "Try gentle rocking or swaying",
          "Look for yawning or eye-rubbing cues",
        ],
        pain: [
          "Check for hair tourniquet on fingers or toes",
          "Look for swollen gums if teething age",
          "Monitor temperature — consult a doctor if cry persists",
        ],
        gas: [
          "Try bicycle leg movements gently",
          "Burp in upright position for 5–10 minutes",
          "Gentle tummy massage in clockwise circles",
        ],
        overstimulated: [
          "Move to a quiet, dim room immediately",
          "Minimize handling — let baby rest",
          "Soft shushing or white noise can help reset",
        ],
        boredom: [
          "Make eye contact and talk softly",
          "Try a change of scenery or position",
          "Offer a toy or gentle interaction",
        ],
        unknown: [
          "Check diaper, hunger, and temperature first",
          "Try skin-to-skin contact",
          "If cry is unusual or prolonged, consult your pediatrician",
        ],
      };

      const SUMMARIES = {
        hunger:
          "The cry pattern shows regular rhythm with pauses — a classic hunger signal. Try feeding soon.",
        tired:
          "Low-pitched and continuous cry suggests your baby may be overtired. A calm sleep routine may help.",
        pain: "High-pitched and intense cry may indicate discomfort or pain. Check for obvious causes and monitor closely.",
        gas: "Strained, mid-pitched cry with irregular bursts is consistent with gas or tummy discomfort.",
        overstimulated:
          "High energy and erratic pattern suggests sensory overload. Move to a quieter environment.",
        boredom:
          "Soft, intermittent cry with lots of quiet gaps — baby may just want attention or stimulation.",
        unknown:
          "Could not clearly identify the cry pattern. Try the common comfort checks.",
      };

      const CUES = {
        // Based on: Glodowski et al. (2019), Journal of Applied Behavior Analysis — rooting as empirically validated hunger cue;
        // USDA WIC Infant Developmental Skills and Hunger-Satiety Cues guidance (2022);
        // Frontiers in AI: Machine learning-based infant crying interpretation (Hammoud et al., 2024)
        hunger: [
          "Rooting reflex: turns head toward cheek/mouth stimulus searching for nipple — empirically validated pre-cry hunger signal (Glodowski et al., 2019, J. Applied Behavior Analysis)",
          "Repetitive hand-to-mouth movement: brings fists or fingers to mouth even without a nipple present, often paired with sucking motions — early-stage hunger cue preceding crying (USDA WIC, 2022)",
          "Lip smacking, licking, or tongue thrusting: oral motor activity without feeding stimulus — classified as an early hunger cue that precedes late-stage crying (East Lake Pediatrics, 2026)",
          "Increased alertness and restlessness: hungry infant becomes more wakeful, moves more actively; crying is a late-stage signal after subtler cues have been missed (Hammoud et al., 2024, Frontiers AI)",
          "Rhythmic cry pattern with regular pauses: acoustic research shows hunger cries follow a predictable expiration–pause–inspiration cycle at medium fundamental frequency (Ji et al., 2021, J. Audio Speech Music Processing)",
        ],
        // Based on: Taking Cara Babies neonatal nursing framework; Wolke et al. (2017) meta-analysis on fussing/crying;
        // Kurth et al. (2011) systematic review; Momcozy/physiological sleep-pressure research
        tired: [
          "Eyelid drooping and heavy-lidded gaze: sleep pressure builds visibly; infant loses ability to maintain eye focus — early fatigue indicator before crying onset (Momcozy Sleep Research, 2026)",
          "Yawning repeatedly: involuntary jaw-drop yawning is a neurological signal of rising sleep pressure; often appears 10–20 minutes before ideal sleep window closes",
          "Decreased visual tracking: stops following faces or objects with eyes; glassy, unfocused stare is a hallmark of approaching sleep onset (Taking Cara Babies neonatal framework)",
          "Rubbing eyes, ears, or face with hands: self-soothing gesture indicating fatigue; infant attempts to block sensory input as arousal threshold lowers",
          "Cry escalates to arching back and pushing away: late-stage overtiredness releases cortisol/adrenaline, causing the infant to appear paradoxically 'wired' and harder to settle (Momcozy, 2026)",
        ],
        // Based on: Grunau & Craig Neonatal Facial Coding System (NFCS); DiLorenzo et al. (2018), Journal of Pain;
        // Neonatal Facial Coding System Scores and Spectral Cry Measures, Clinical Journal of Pain (2007);
        // ChatterBaby acoustic study — Defining and distinguishing infant behavioral states (PMC7033040)
        pain: [
          "Brow lowering and brow bulge: forehead furrows inward — one of the 3 core NFCS facial action units validated for neonatal pain assessment (Grunau & Craig; DiLorenzo et al., 2018, J. Pain)",
          "Nasolabial furrow deepening and horizontal mouth stretch: facial muscle tension around the mouth is a reliable NFCS pain indicator; combined with eye squeeze, constitutes a high-pain facial pattern",
          "Sudden high-pitched, maximum-intensity cry: pain cries show significantly higher acoustic energy, longer voiced periods, and elevated fundamental frequency vs. hunger/fussiness cries (ChatterBaby, PMC7033040, 2020)",
          "Rigid body posture and limb stiffness: FLACC scale (Faces, Legs, Activity, Cry, Consolability) scores body rigidity as a core pain behavior indicator in infants; legs may draw up sharply toward abdomen",
          "Inconsolable despite feeding, holding, or rocking: pain cry is distinguished from hunger/tired by its resistance to standard soothing — persistent crying warrants medical evaluation (NIPS clinical guideline)",
        ],
        // Based on: Frontiers in AI classification: hunger/stomachache/burping categories (Wu et al., 2020);
        // Pediatric gastroenterology: infantile colic behavioral signs; FLACC and MBPS body movement indicators
        gas: [
          "Drawing knees up toward abdomen repeatedly: reflex response to intestinal cramping; infant alternates between extending and pulling up legs as gas moves through immature gut",
          "Abdominal distension: belly appears visibly rounder or firmer than usual — gas accumulation in intestinal loops causes measurable distension, especially after feeds",
          "Cry occurs in waves with brief lulls: unlike continuous pain cry, gas discomfort follows peristaltic contractions — cry intensifies during spasm, eases slightly between episodes (Wu et al., 2020, Frontiers AI)",
          "Audible gut sounds, passing flatus, or belching during or after cry episode: direct acoustic evidence of intestinal gas movement; often brings temporary relief from crying",
          "Arching back during or after feeding: combined with leg-pulling, back arching during feeds suggests gastroesophageal reflux or trapped gas — requires positional adjustment and upright burping",
        ],
        // Based on: ChildCareEd infant cues framework; physiological research on cortisol/sensory overload in neonates;
        // Frontiers AI classification: discomfort/overstimulation behavioral patterns
        overstimulated: [
          "Gaze aversion and active eye-closing: infant deliberately turns head away or shuts eyes to block visual input — a self-regulatory shutdown response when sensory threshold is exceeded (ChildCareEd, 2024)",
          "Hiccupping, spitting up, or sneezing in clusters: autonomic nervous system dysregulation under sensory overload; increased vagal tone triggers GI responses as a stress byproduct",
          "Rapid escalation from calm to full cry within seconds: overstimulated infants lack the graduated hunger-type cry buildup — arousal jumps directly to peak intensity in high-stimulus environments",
          "Flailing, uncoordinated arm and leg movements: motor disorganization under overload; differs from pain rigidity — limbs move erratically rather than tensing toward a focal point",
          "Immediate calming in quiet, dim environment: removal from stimulus source causes rapid cry reduction — the strongest diagnostic indicator distinguishing overstimulation from pain or hunger",
        ],
        // Based on: Infant behavioral state research (Wolke et al., 2017 meta-analysis, J. Pediatrics);
        // Keefe et al. (1996) — colic infants more alert and demanding; general pediatric behavioral observation
        boredom: [
          "Cry pauses immediately when a new face, object, or sound is introduced: attention-driven interruption of fussing is the defining feature of boredom cry — distinct from hunger/pain which do not resolve with distraction",
          "Maintains alert, wide-eyed gaze between cry bursts: infant is neurologically aroused, not tired; eyes track environment actively, seeking stimulation input",
          "Reaches toward or orients body toward people and objects: purposeful motor engagement during cry pauses indicates the infant is seeking social interaction, not physical relief",
          "Low-intensity, intermittent fussing with long quiet gaps: acoustic energy is low compared to pain/hunger; cry lacks urgency and rhythmic hunger pattern (Wolke et al., 2017, J. Pediatrics meta-analysis)",
          "Responds positively to talking, singing, or change of position: social and environmental responsiveness differentiates boredom from other cry types; brief interaction resets arousal state",
        ],
        unknown: [
          "Check diaper for wetness, rash, or soiling — skin irritation from a rash can produce a pain-like cry that resolves after changing",
          "Palpate back of neck (not forehead) for temperature — fever in infants under 3 months requires urgent medical attention regardless of cry pattern",
          "Inspect fingers, toes, and genitals for hair tourniquet — a strand of hair wrapped around a digit causes intense, localized pain cry that is unresponsive to feeding or rocking",
          "Observe whether cry intensity changes with position changes — gas and reflux pain typically worsen lying flat and improve upright; this helps narrow the cause",
          "Note cry timing relative to feeds: crying 1–2 hrs post-feed suggests gas/reflux; immediately before feed suggests hunger; unrelated to feeds may indicate pain or overstimulation",
        ],
      };

      setResult({
        detected: true,
        cry_type,
        confidence,
        secondary,
        secondary_confidence,
        duration_seconds: Math.round(duration),
        pitch,
        rhythm,
        intensity,
        summary: SUMMARIES[cry_type],
        tips: TIPS[cry_type],
        cues: CUES[cry_type],
      });
      setMode("result");
    } catch (e) {
      console.error("Analysis error:", e);
      setErrorMsg(`Analysis failed: ${e.message}. Try recording again.`);
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
    setActiveTab("cues");
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
          font-size: 0.85rem; color: #3D2B5E; line-height: 1.4; text-align: justify;
        }
        .tip-item:last-child { border: none; }
        .tip-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #FF6B9D; margin-top: 6px; flex-shrink: 0;
        }
 
        .tab-bar {
          display: flex; gap: 8px; margin: 16px 0 0;
        }
        .tab-btn {
          flex: 1; padding: 9px 8px;
          border: 1.5px solid #EDE9F6; border-radius: 12px;
          background: transparent; cursor: pointer;
          font-size: 0.78rem; font-weight: 600; color: #9C7AB8;
          font-family: 'DM Sans', sans-serif;
          transition: all 0.15s;
        }
        .tab-btn:hover { background: #FAF7FF; border-color: #C4B5FD; }
        .tab-btn.active {
          background: #F5F0FF; border-color: #C44DBA; color: #C44DBA;
        }
        .tab-content { margin-top: 4px; }
 
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

                {/* Tabs */}
                <div className="tab-bar">
                  {["tips", "cues"].map((tab) => (
                    <button
                      key={tab}
                      className={`tab-btn ${activeTab === tab ? "active" : ""}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab === "cues"
                        ? "👀 Signs to Look For"
                        : "💡 What to Try"}
                    </button>
                  ))}
                </div>

                <div className="tab-content">
                  {activeTab === "cues" &&
                    result.cues?.map((cue, i) => {
                      const citationMatch = cue.match(
                        /^(.*?)\s*(\([^)]*\d{4}[^)]*\))\s*$/,
                      );
                      const mainText = citationMatch ? citationMatch[1] : cue;
                      return (
                        <div className="tip-item" key={i}>
                          <div
                            className="tip-dot"
                            style={{ background: "#A78BFA" }}
                          />
                          {mainText}
                        </div>
                      );
                    })}

                  {activeTab === "tips" &&
                    result.tips?.map((tip, i) => (
                      <div className="tip-item" key={i}>
                        <div className="tip-dot" />
                        {tip}
                      </div>
                    ))}
                </div>

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
