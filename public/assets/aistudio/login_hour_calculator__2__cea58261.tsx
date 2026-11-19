import React, { useState, useEffect, useMemo, useRef } from 'react';

// --- Utility Functions for Time Math ---

// Converts "HH:MM:SS" or "HH:MM" to total seconds
const timeToSeconds = (timeStr) => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0] || 0) * 3600 + parseInt(parts[1] || 0) * 60 + parseInt(parts[2] || 0);
  } else if (parts.length === 2) {
    return parseInt(parts[0] || 0) * 3600 + parseInt(parts[1] || 0) * 60;
  }
  return 0;
};

// Converts total seconds to "HH:MM:SS" format
const secondsToTime = (totalSeconds) => {
  if (isNaN(totalSeconds)) return "00:00:00";
  const isNegative = totalSeconds < 0;
  const absSeconds = Math.abs(totalSeconds);
  const h = Math.floor(absSeconds / 3600);
  const m = Math.floor((absSeconds % 3600) / 60);
  const s = absSeconds % 60;
  const formatted = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return isNegative ? `-${formatted}` : formatted;
};

// Formats total seconds into a readable 12-hour AM/PM time format (e.g. 05:30 PM)
const formatTimeOfDay = (totalSeconds) => {
  if (isNaN(totalSeconds)) return "00:00 AM";
  let absSeconds = totalSeconds % 86400; // constrain to 24 hours (1 day)
  if (absSeconds < 0) absSeconds += 86400; // handle negative wrapping
  
  let h = Math.floor(absSeconds / 3600);
  const m = Math.floor((absSeconds % 3600) / 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12; // the hour '0' should be '12'
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
};

// Gets the current system time in "HH:MM" format for the input field
const getCurrentTimeStr = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};


export default function App() {
  // State variables for inputs
  const [loginDuration, setLoginDuration] = useState('00:00:00');
  const [breakDuration, setBreakDuration] = useState('00:00:00');
  const [targetShift, setTargetShift] = useState('07:15:00');
  const [manualTarget, setManualTarget] = useState({ h: '08', m: '00', s: '00' });
  const [concession, setConcession] = useState(0);
  const [currentTime, setCurrentTime] = useState(getCurrentTimeStr());
  
  // UI State
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const fileInputRef = useRef(null);

  // Derived Calculations using useMemo to update dynamically when inputs change
  const calculations = useMemo(() => {
    const loginSecs = timeToSeconds(loginDuration);
    const breakSecs = timeToSeconds(breakDuration);
    const activeTargetStr =
      targetShift === 'manual'
        ? `${manualTarget.h || '00'}:${manualTarget.m || '00'}:${manualTarget.s || '00'}`
        : targetShift;
    const targetSecs = timeToSeconds(activeTargetStr);
    const concessionSecs = concession * 60;
    const currentTimeSecs = timeToSeconds(currentTime);

    // Calculation 1: Net Login = Login Duration - Break Duration
    const netLoginSecs = Math.max(0, loginSecs - breakSecs);
    
    // Calculation 2: Deficit = Target - Net Login - Concession
    const deficitSecs = targetSecs - netLoginSecs;
    const adjustedDeficitSecs = Math.max(0, deficitSecs - concessionSecs);
    
    // Calculation 3: Completed Time = Current Time + Deficit
    const completedTimeSecs = currentTimeSecs + adjustedDeficitSecs;

    return {
      netLogin: secondsToTime(netLoginSecs),
      deficit: secondsToTime(Math.max(0, deficitSecs)),
      adjustedDeficit: secondsToTime(adjustedDeficitSecs),
      completedTime: formatTimeOfDay(completedTimeSecs),
      completedTimeSecs
    };
  }, [loginDuration, breakDuration, targetShift, manualTarget, concession, currentTime]);

  // Handle uploading and analyzing the screenshot with Gemini
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setErrorMsg('');
    setIsProcessing(true);

    try {
      // 1. Convert file to base64
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
      });

      // 2. Call Gemini API for Image Understanding
      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              { 
                text: `You are an expert OCR data extractor. Look at the provided screenshot of a call center dashboard. 
                Extract the 'Total Login Duration' and 'Total Break Duration'. 
                Convert the extracted times strictly into HH:MM:SS format. 
                For Example: "1h 58m 18s" becomes "01:58:18", and "31m 48s" becomes "00:31:48".
                Return a JSON object exactly like this, with no markdown formatting or extra text:
                {
                  "loginDuration": "HH:MM:SS",
                  "breakDuration": "HH:MM:SS"
                }
                If a value is not found, default to "00:00:00".` 
              },
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json" // Enforce structured JSON response
        }
      };

      const apiKey = ""; // API key is populated automatically by the platform runtime
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (result.candidates && result.candidates.length > 0) {
        const jsonText = result.candidates[0].content.parts[0].text;
        const data = JSON.parse(jsonText);
        
        // Update editable fields
        if (data.loginDuration) setLoginDuration(data.loginDuration);
        if (data.breakDuration) setBreakDuration(data.breakDuration);
        
        // Update current time to exact current moment on fresh extraction
        setCurrentTime(getCurrentTimeStr());
      } else {
        throw new Error("Could not extract data from the image.");
      }

    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to process image. Please check the file or enter data manually.');
    } finally {
      setIsProcessing(false);
      // Reset input so the same file can be selected again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Header Section */}
        <div className="lg:col-span-12 mb-2">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Login Hour Calculator
          </h1>
          <p className="text-slate-500 mt-1">Upload your dashboard screenshot to auto-calculate your net login, deficit, and completion time.</p>
        </div>

        {/* Input & Control Panel */}
        <div className="lg:col-span-5 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col gap-6">
          
          {/* File Upload UI */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">1. Upload Screenshot (Auto-Extract)</label>
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                ref={fileInputRef}
                className="hidden"
                id="file-upload"
              />
              <label 
                htmlFor="file-upload" 
                className={`flex items-center justify-center w-full px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ${isProcessing ? 'border-indigo-300 bg-indigo-50 text-indigo-500 cursor-not-allowed' : 'border-slate-300 hover:border-indigo-500 hover:bg-slate-50 text-slate-600'}`}
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Scanning Image...
                  </span>
                ) : (
                  <span className="flex items-center gap-2 font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    Upload Dashboard Screenshot
                  </span>
                )}
              </label>
            </div>
            {errorMsg && <p className="text-red-500 text-xs mt-2">{errorMsg}</p>}
          </div>

          <div className="w-full h-px bg-slate-100"></div>

          {/* Editable Manual Inputs */}
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-slate-700">2. Verify & Adjust Details</label>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Total Login</label>
                <input 
                  type="text" 
                  value={loginDuration} 
                  onChange={(e) => setLoginDuration(e.target.value)}
                  placeholder="HH:MM:SS"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Total Break</label>
                <input 
                  type="text" 
                  value={breakDuration} 
                  onChange={(e) => setBreakDuration(e.target.value)}
                  placeholder="HH:MM:SS"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Target Shift</label>
              <div className="relative">
                <select 
                  value={targetShift}
                  onChange={(e) => setTargetShift(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all appearance-none cursor-pointer"
                >
                  <option value="07:30:00">7 Hours 30 Mins (07:30:00)</option>
                  <option value="07:15:00">7 Hours 15 Mins (07:15:00)</option>
                  <option value="07:00:00">7 Hours 00 Mins (07:00:00)</option>
                  <option value="06:30:00">6 Hours 30 Mins (06:30:00)</option>
                  <option value="06:15:00">6 Hours 15 Mins (06:15:00)</option>
                  <option value="manual">Manual Target (Custom HH:MM:SS)</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>

              {targetShift === 'manual' && (
                <div className="grid grid-cols-3 gap-2 mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Hours</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={manualTarget.h}
                      onChange={(e) => setManualTarget({ ...manualTarget, h: e.target.value })}
                      placeholder="HH"
                      className="w-full bg-white border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Minutes</label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={manualTarget.m}
                      onChange={(e) => setManualTarget({ ...manualTarget, m: e.target.value })}
                      placeholder="MM"
                      className="w-full bg-white border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Seconds</label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={manualTarget.s}
                      onChange={(e) => setManualTarget({ ...manualTarget, s: e.target.value })}
                      placeholder="SS"
                      className="w-full bg-white border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Concession (Mins)</label>
                <input 
                  type="number" 
                  min="0"
                  value={concession} 
                  onChange={(e) => setConcession(parseInt(e.target.value) || 0)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Current Time</label>
                <input 
                  type="time" 
                  value={currentTime} 
                  onChange={(e) => setCurrentTime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
            </div>
            
            <button 
              onClick={() => setCurrentTime(getCurrentTimeStr())}
              className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-sm transition-colors flex justify-center items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Sync to System Time
            </button>
          </div>
        </div>

        {/* Output & Results Dashboard */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          {/* Net Login Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-center relative overflow-hidden group">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 rounded-full group-hover:scale-110 transition-transform duration-500 ease-out"></div>
            <div className="relative z-10 flex items-center justify-between mb-2">
               <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Net Login</p>
               <svg xmlns="http://www.w3.org/2000/svg" className="text-blue-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
            </div>
            <p className="text-4xl font-extrabold text-blue-600 font-mono relative z-10">{calculations.netLogin}</p>
            <p className="text-xs text-slate-400 mt-2 relative z-10 font-medium">Login Duration - Break</p>
          </div>

          {/* Time Deficit Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-center relative overflow-hidden group">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-rose-50 rounded-full group-hover:scale-110 transition-transform duration-500 ease-out"></div>
            <div className="relative z-10 flex items-center justify-between mb-2">
               <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Time Deficit</p>
               <svg xmlns="http://www.w3.org/2000/svg" className="text-rose-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </div>
            <p className="text-4xl font-extrabold text-rose-500 font-mono relative z-10">{calculations.adjustedDeficit}</p>
            <p className="text-xs text-slate-400 mt-2 relative z-10 font-medium">Target - Net Login - Concession</p>
          </div>

          {/* Estimated Completion Time Hero Card */}
          <div className="bg-indigo-600 rounded-2xl shadow-lg border border-indigo-500 p-8 sm:col-span-2 flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none">
               <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            </div>
            <div className="absolute bottom-0 left-0 p-10 opacity-10 pointer-events-none rotate-180 transform">
               <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg>
            </div>
            
            <div className="inline-flex items-center gap-2 bg-indigo-500/50 rounded-full px-4 py-1.5 mb-4 relative z-10 border border-indigo-400/50">
               <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
               <p className="text-indigo-50 font-semibold uppercase tracking-widest text-xs">Estimated Completion Time</p>
            </div>
            
            <div className="flex items-end gap-2 mt-2 relative z-10">
              <span className="text-6xl md:text-7xl font-black text-white tracking-tight drop-shadow-sm">{calculations.completedTime.split(' ')[0]}</span>
              <span className="text-2xl md:text-3xl font-bold text-indigo-200 mb-2">{calculations.completedTime.split(' ')[1]}</span>
            </div>
            
            <div className="mt-6 bg-indigo-700/40 rounded-xl px-5 py-3 relative z-10 border border-indigo-500/50">
               <p className="text-indigo-100 text-sm max-w-sm">
                 Based on your adjusted deficit of <span className="font-bold text-white bg-indigo-500/50 px-1.5 py-0.5 rounded">{calculations.adjustedDeficit}</span> added to the current time of <span className="font-bold text-white bg-indigo-500/50 px-1.5 py-0.5 rounded">{currentTime}</span>.
               </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}