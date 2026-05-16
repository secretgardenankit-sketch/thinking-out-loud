import { useState, useEffect, useRef, useCallback } from "react";

const SPEECH_LANG_MAP = { en: "en-US", hi: "hi-IN" };

export default function App() {
  const [screen, setScreen] = useState("home");
  const [isRecording, setIsRecording] = useState(false);
  const [subtitles, setSubtitles] = useState("");
  const [finalSubtitles, setFinalSubtitles] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [editItem, setEditItem] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [translating, setTranslating] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [gain, setGain] = useState(0);
  const [eqOn, setEqOn] = useState(false);
  const [noiseOn, setNoiseOn] = useState(false);
  const [noiseFreq, setNoiseFreq] = useState(100);

  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const streamRef = useRef(null);
  const volumeRef = useRef(0);
  const editAudioCtxRef = useRef(null);
  const editHighPassRef = useRef(null);
  const editEQRef = useRef(null);
  const editGainRef = useRef(null);
  const editAudioElRef = useRef(null);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserRef.current) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += Math.abs(dataArray[i] - 128);
    const rawVolume = sum / dataArray.length;
    volumeRef.current = volumeRef.current * 0.4 + rawVolume * 0.6;
    const vol = volumeRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;

    const centerX = W / 2;
    const centerY = H / 2;
    const triWidth = Math.max(8, Math.min(vol * 10, W * 0.22));
    const triHeight = Math.max(1, Math.min(vol * 7, H * 0.40));

    ctx.moveTo(0, centerY);
    ctx.lineTo(centerX - triWidth, centerY);
    ctx.lineTo(centerX - triWidth * 0.5, centerY - triHeight);
    ctx.lineTo(centerX, centerY);
    ctx.lineTo(centerX + triWidth * 0.5, centerY + triHeight);
    ctx.lineTo(centerX + triWidth, centerY);
    ctx.lineTo(W, centerY);
    ctx.stroke();

    animFrameRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  const drawIdle = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
  }, []);

  useEffect(() => {
    if (screen === "recording") {
      setTimeout(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = canvas.offsetWidth;
          canvas.height = canvas.offsetHeight;
          drawIdle();
        }
      }, 100);
    }
  }, [screen, drawIdle]);

  const setupEditAudio = useCallback(() => {
    if (!editAudioElRef.current || !editItem) return;
    if (editAudioCtxRef.current) editAudioCtxRef.current.close();

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    editAudioCtxRef.current = ctx;

    const source = ctx.createMediaElementSource(editAudioElRef.current);

    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = noiseOn ? noiseFreq : 20;
    highPass.Q.value = 0.7;
    editHighPassRef.current = highPass;

    const eq = ctx.createBiquadFilter();
    eq.type = "peaking";
    eq.frequency.value = 2000;
    eq.gain.value = eqOn ? 6 : 0;
    eq.Q.value = 1.0;
    editEQRef.current = eq;

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.pow(10, gain / 20);
    editGainRef.current = gainNode;

    source.connect(highPass);
    highPass.connect(eq);
    eq.connect(gainNode);
    gainNode.connect(ctx.destination);
  }, [editItem, gain, noiseOn, noiseFreq, eqOn]);

  useEffect(() => {
    if (screen === "edit" && editItem) {
      setTimeout(() => {
        if (editAudioElRef.current) setupEditAudio();
      }, 300);
    }
    return () => {
      if (editAudioCtxRef.current) {
        editAudioCtxRef.current.close();
        editAudioCtxRef.current = null;
      }
    };
  }, [screen, editItem]);

  useEffect(() => {
    if (editHighPassRef.current) {
      editHighPassRef.current.frequency.value = noiseOn ? noiseFreq : 20;
    }
  }, [noiseOn, noiseFreq]);

  useEffect(() => {
    if (editEQRef.current) {
      editEQRef.current.gain.value = eqOn ? 6 : 0;
    }
  }, [eqOn]);

  useEffect(() => {
    if (editGainRef.current) {
      editGainRef.current.gain.value = Math.pow(10, gain / 20);
    }
  }, [gain]);

  const getSupportedMimeType = () => {
    const types = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "";
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.3;
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      const mimeType = getSupportedMimeType();
      mediaRecorderRef.current = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      chunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorderRef.current.start();

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = SPEECH_LANG_MAP["hi"];
        recognitionRef.current.onresult = (e) => {
          let interim = "", final = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
            else interim += e.results[i][0].transcript;
          }
          if (final) setFinalSubtitles(prev => [...prev, final.trim()]);
          setSubtitles(interim);
        };
        recognitionRef.current.start();
      }

      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
      setIsRecording(true);
      drawWaveform();
    } catch {
      alert("Microphone access denied. Please allow microphone access.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      const mimeType = mediaRecorderRef.current.mimeType || "audio/mp4";
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const ext = mimeType.includes("mp4") || mimeType.includes("aac") ? "m4a" : "webm";
        const allText = [...finalSubtitles, subtitles].filter(Boolean).join(" ");
        const rec = {
          id: Date.now(), url, blob, ext,
          duration: elapsed,
          transcript: allText,
          date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
          translation: "",
        };
        setRecordings(prev => [rec, ...prev]);
        setEditItem(rec);
        setGain(0);
        setEqOn(false);
        setNoiseOn(false);
        setNoiseFreq(100);
        setScreen("edit");
      };
      mediaRecorderRef.current.stop();
    }
    if (recognitionRef.current) recognitionRef.current.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    setIsRecording(false);
    setSubtitles("");
    setFinalSubtitles([]);
    setElapsed(0);
    volumeRef.current = 0;
  };

  const audioBufferToWav = (buffer) => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);
    const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    return arrayBuffer;
  };

  const handleExport = async () => {
    if (!editItem?.blob) return;
    setExportMsg("Processing audio...");
    try {
      const offlineCtx = new OfflineAudioContext(1, 44100 * (editItem.duration || 60), 44100);
      const arrayBuffer = await editItem.blob.arrayBuffer();
      const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      const highPass = offlineCtx.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = noiseOn ? noiseFreq : 20;
      highPass.Q.value = 0.7;

      const eq = offlineCtx.createBiquadFilter();
      eq.type = "peaking";
      eq.frequency.value = 2000;
      eq.gain.value = eqOn ? 6 : 0;
      eq.Q.value = 1.0;

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = Math.pow(10, gain / 20);

      source.connect(highPass);
      highPass.connect(eq);
      eq.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      source.start();

      const rendered = await offlineCtx.startRendering();
      const wavBuffer = audioBufferToWav(rendered);
      const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thinking-out-loud-${editItem.date}.wav`.replace(/\s/g, "-");
      a.click();
      setExportMsg("Saved! Open in Files app → tap Share → Save to Photos.");
    } catch {
      const a = document.createElement("a");
      a.href = editItem.url;
      a.download = `thinking-out-loud-${editItem.date}.${editItem.ext || "m4a"}`.replace(/\s/g, "-");
      a.click();
      setExportMsg("Saved to Files app.");
    }
    setTimeout(() => setExportMsg(""), 5000);
  };

  const handleTranslate = async (targetLang) => {
    if (!editItem?.transcript) return;
    const toLabel = targetLang === "en" ? "English" : "Hindi";
    setTranslating(true);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: `Translate to ${toLabel}. Return ONLY translated text:\n\n${editItem.transcript}` }]
        })
      });
      const data = await response.json();
      const result = data.content?.[0]?.text || "";
      setEditItem(prev => ({ ...prev, translation: result, targetLang }));
      setRecordings(prev => prev.map(r => r.id === editItem.id ? { ...r, translation: result } : r));
    } catch {
      alert("Translation failed. Please try again.");
    }
    setTranslating(false);
  };

  const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const Toggle = ({ on, onToggle, label, sub }) => (
    <div onClick={onToggle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#111", borderRadius: 10, border: `1px solid ${on ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)"}`, cursor: "pointer", transition: "border 0.2s" }}>
      <div>
        <div style={{ fontSize: 14, color: on ? "#fff" : "rgba(255,255,255,0.6)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ width: 44, height: 24, borderRadius: 12, background: on ? "#fff" : "rgba(255,255,255,0.15)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: on ? "#000" : "rgba(255,255,255,0.6)", transition: "left 0.2s" }} />
      </div>
    </div>
  );

  // ─── HOME ─────────────────────────────────────────────────────────────────
  if (screen === "home") return (
    <div style={{ background: "#000", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Georgia', serif", color: "#fff", padding: "40px 28px", gap: 40 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.35em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 16 }}>Voice Journal</div>
        <div style={{ fontSize: 44, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.15 }}>Thinking<br /><span style={{ fontStyle: "italic" }}>Out Loud</span></div>
      </div>
      <svg width="100%" height="40" style={{ maxWidth: 300 }} viewBox="0 0 300 40">
        <line x1="0" y1="20" x2="300" y2="20" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 300 }}>
        <button onClick={() => setScreen("recording")} style={{ background: "#fff", color: "#000", border: "none", borderRadius: 50, padding: "18px 0", fontSize: 16, fontFamily: "'Georgia', serif", fontStyle: "italic", cursor: "pointer" }}>Start Recording</button>
        {recordings.length > 0 && (
          <button onClick={() => setScreen("library")} style={{ background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 50, padding: "14px 0", fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>Library ({recordings.length})</button>
        )}
      </div>
    </div>
  );

  // ─── RECORDING ────────────────────────────────────────────────────────────
  if (screen === "recording") return (
    <div style={{ background: "#000", height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Georgia', serif", color: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px" }}>
        <button onClick={() => { if (isRecording) stopRecording(); else setScreen("home"); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>←</button>
        {isRecording ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff4444", animation: "pulse 1s infinite" }} />
            <span style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", letterSpacing: "0.1em" }}>{formatTime(elapsed)}</span>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>tap to begin</div>
        )}
        <div style={{ width: 32 }} />
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        {(subtitles || finalSubtitles.length > 0) && (
          <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, padding: "0 24px", textAlign: "center" }}>
            <div style={{ background: "rgba(0,0,0,0.75)", display: "inline-block", padding: "10px 18px", borderRadius: 10, maxWidth: "92%" }}>
              <span style={{ fontSize: 16, lineHeight: 1.6, color: "#fff" }}>
                {finalSubtitles.slice(-2).join(" ")} <span style={{ color: "rgba(255,255,255,0.45)" }}>{subtitles}</span>
              </span>
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: "24px 0 44px", display: "flex", justifyContent: "center" }}>
        {!isRecording ? (
          <button onClick={startRecording} style={{ width: 72, height: 72, borderRadius: "50%", background: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#ff4444" }} />
          </button>
        ) : (
          <button onClick={stopRecording} style={{ width: 72, height: 72, borderRadius: "50%", background: "transparent", border: "2px solid #fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 22, height: 22, borderRadius: 4, background: "#fff" }} />
          </button>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );

  // ─── EDIT ─────────────────────────────────────────────────────────────────
  if (screen === "edit" && editItem) return (
    <div style={{ background: "#000", minHeight: "100vh", fontFamily: "'Georgia', serif", color: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "20px 24px 0", gap: 16 }}>
        <button onClick={() => setScreen("library")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>←</button>
        <div>
          <div style={{ fontSize: 16, fontStyle: "italic" }}>{editItem.date}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{editItem.time} · {formatTime(editItem.duration)}</div>
        </div>
      </div>

      <div style={{ flex: 1, padding: "24px", display: "flex", flexDirection: "column", gap: 24, overflowY: "auto" }}>

        <audio ref={editAudioElRef} src={editItem.url} controls
          onPlay={() => { if (editAudioCtxRef.current?.state === "suspended") editAudioCtxRef.current.resume(); }}
          style={{ width: "100%", filter: "invert(1)", borderRadius: 8 }} />

        {/* Gain */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Volume Gain</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{gain > 0 ? `+${gain}` : gain} dB</div>
          </div>
          <input type="range" min="-10" max="10" step="1" value={gain} onChange={e => setGain(Number(e.target.value))} style={{ width: "100%", accentColor: "#fff", cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
            <span>-10</span><span>0</span><span>+10</span>
          </div>
        </div>

        {/* Toggles */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Toggle on={eqOn} onToggle={() => setEqOn(p => !p)} label="Voice Clarity" sub="Boost 1kHz–4kHz voice range" />
          <Toggle on={noiseOn} onToggle={() => setNoiseOn(p => !p)} label="Noise Filter" sub={`High-pass at ${noiseFreq}Hz`} />
          {noiseOn && (
            <div style={{ display: "flex", gap: 8 }}>
              {[80, 100, 120, 150].map(freq => (
                <button key={freq} onClick={() => setNoiseFreq(freq)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: noiseFreq === freq ? "1px solid #fff" : "1px solid rgba(255,255,255,0.15)", background: noiseFreq === freq ? "#fff" : "transparent", color: noiseFreq === freq ? "#000" : "rgba(255,255,255,0.5)", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                  {freq}Hz
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transcript */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 10 }}>Transcript</div>
          <textarea value={editItem.transcript} onChange={e => setEditItem(prev => ({ ...prev, transcript: e.target.value }))}
            style={{ width: "100%", minHeight: 100, background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: 16, borderRadius: 8, fontSize: 15, fontFamily: "inherit", lineHeight: 1.6, resize: "vertical", boxSizing: "border-box" }} />
        </div>

        {/* Translate */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 12 }}>Translate</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {["en", "hi"].map(lang => (
              <button key={lang} onClick={() => handleTranslate(lang)} disabled={translating}
                style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: translating ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                {lang === "en" ? "→ English" : "→ Hindi"}
              </button>
            ))}
          </div>
          {editItem.translation && (
            <div style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)", padding: 16, borderRadius: 8, fontSize: 15, lineHeight: 1.7, color: "rgba(255,255,255,0.85)" }}>
              {translating ? "Translating..." : editItem.translation}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "0 24px 44px", display: "flex", flexDirection: "column", gap: 12 }}>
        {exportMsg && <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>{exportMsg}</div>}
        <button onClick={handleExport} style={{ background: "#fff", color: "#000", border: "none", borderRadius: 50, padding: "16px", fontSize: 15, fontFamily: "'Georgia', serif", fontStyle: "italic", cursor: "pointer" }}>Export to Phone</button>
        <button onClick={() => setScreen("recording")} style={{ background: "transparent", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 50, padding: "14px", fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>New Recording</button>
      </div>
    </div>
  );

  // ─── LIBRARY ──────────────────────────────────────────────────────────────
  if (screen === "library") return (
    <div style={{ background: "#000", minHeight: "100vh", fontFamily: "'Georgia', serif", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "20px 24px", gap: 16 }}>
        <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>←</button>
        <div style={{ fontSize: 20, fontStyle: "italic" }}>Library</div>
      </div>
      <div style={{ padding: "8px 24px" }}>
        {recordings.length === 0 && <div style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", padding: "60px 0", fontSize: 15, fontStyle: "italic" }}>No recordings yet</div>}
        {recordings.map(rec => (
          <div key={rec.id} onClick={() => { setEditItem(rec); setGain(0); setEqOn(false); setNoiseOn(false); setNoiseFreq(100); setScreen("edit"); }}
            style={{ padding: "18px 0", borderBottom: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, marginBottom: 3, fontStyle: "italic" }}>{rec.date}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{rec.time} · {formatTime(rec.duration)}</div>
              {rec.transcript && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.transcript.slice(0, 55)}…</div>}
            </div>
            <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 20, paddingLeft: 12 }}>›</span>
          </div>
        ))}
      </div>
      <div style={{ padding: "24px 24px 44px" }}>
        <button onClick={() => setScreen("recording")} style={{ width: "100%", background: "#fff", color: "#000", border: "none", borderRadius: 50, padding: "16px", fontSize: 15, fontFamily: "'Georgia', serif", fontStyle: "italic", cursor: "pointer" }}>New Recording</button>
      </div>
    </div>
  );

  return null;
}