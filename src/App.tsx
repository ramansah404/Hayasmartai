import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, Settings, LogOut } from "lucide-react";
import { getHayaResponse, getHayaAudio, resetHayaSession, transcribeAudio } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";
import { auth, signInWithGoogle, logOut } from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { saveConversation, subscribeToMessages, clearMessages, savePreferences, subscribeToPreferences, updatePreference, deletePreference } from "./services/dbService";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "haya";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<Record<string, any>>({});
  const preferencesRef = useRef(preferences);
  const [showSettings, setShowSettings] = useState(false);
  const [appState, setAppState] = useState<AppState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      const unsubMessages = subscribeToMessages(user.uid, (msgs) => {
        setMessages(msgs);
      });
      const unsubPrefs = subscribeToPreferences(user.uid, (prefs) => {
        setPreferences(prefs);
        preferencesRef.current = prefs;
      });
      return () => {
        unsubMessages();
        unsubPrefs();
      };
    } else {
      setMessages([]);
      setPreferences({});
    }
  }, [user]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Ref-based guard: prevents startSession() from being entered concurrently.
  // Using a ref (not state) because state values are stale inside async closures.
  const isStartingSessionRef = useRef(false);

  // Refs for settings modal new-preference inputs — avoids document.getElementById
  const newPrefKeyRef = useRef<HTMLInputElement>(null);
  const newPrefValueRef = useRef<HTMLInputElement>(null);

  // scrollToBottom is memoised so it never forces a re-render;
  // only depends on messages, not on every appState transition.
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim() || !user) {
      setAppState("idle");
      return;
    }

    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      saveConversation(user.uid, finalTranscript, responseText);

      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getHayaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      setTimeout(() => {
        if (commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. General Chit-Chat via Gemini
      responseText = await getHayaResponse(user.uid, finalTranscript,
        (key, value) => updatePreference(user.uid, key, value),
        (key) => deletePreference(user.uid, key)
      );
      saveConversation(user.uid, finalTranscript, responseText);

      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getHayaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
      setAppState("idle");
    }
    // `preferences` removed from deps — the callback reads from preferencesRef, not
    // the state value, so including it was causing unnecessary recreations on every
    // preference write (which happens frequently during live sessions).
  }, [isMuted, isSessionActive, user]);

  useEffect(() => {
    return () => {
      //if (liveSessionRef.current) {
      //  liveSessionRef.current.stop();
      //}
    };
  }, []);

  const startSession = async () => {
    if (!user) return;

    // Primary guard: if a LiveSessionManager already exists, a session is either
    // running or in the process of being torn down. Either way, do not start another.
    if (liveSessionRef.current) {
      console.log("[App] Session already exists — ignoring startSession call.");
      return;
    }

    // Secondary guard: ref-based flag prevents re-entry during the async
    // startup sequence (before liveSessionRef.current is assigned).
    if (isStartingSessionRef.current || isSessionActive) return;
    isStartingSessionRef.current = true;
    try {
      setIsSessionActive(true);
      resetHayaSession();

      const session = new LiveSessionManager();
      session.isMuted = isMuted;
      liveSessionRef.current = session;

      session.onStateChange = (state) => {
        setAppState(state);
      };

      session.onMessage = (userMsg, aiMsg) => {
        if (user) {
          saveConversation(user.uid, userMsg, aiMsg);
        }
      };

      session.onCommand = (url) => {
        setTimeout(() => {
          window.open(url, "_blank");
        }, 1000);
      };

      session.onUpdatePreference = (key, value) => {
        if (user) {
          updatePreference(user.uid, key, value);
        }
      };

      session.onDeletePreference = (key) => {
        if (user) {
          deletePreference(user.uid, key);
        }
      };

      session.onError = (error) => {
        console.error("Live session error:", error);
        if (error.message.includes("Network error") || error.message.includes("network")) {
          alert("Network error: The connection to Haya was lost. Please check your internet connection and try again.");
        } else {
          alert("An error occurred during the live session. Please try again.");
        }
        setIsSessionActive(false);
        setAppState("idle");
      };

      session.onExpire = () => {
        console.log("[App] Session expired. Restarting after teardown...");
        // Clear the ref first so the liveSessionRef guard in startSession
        // doesn't block the re-connect after the old session stops.
        liveSessionRef.current = null;
        // Wait for stop() to fully unwind before opening a new WebSocket.
        setTimeout(() => startSession(), 500);
      };

      await session.start(user.uid);
    } catch (e: any) {
      console.error("Detailed session start error:", {
        name: e.name,
        message: e.message,
        stack: e.stack,
        cause: e.cause
      });
      const isPermissionError =
        e.name === 'NotAllowedError' ||
        e.name === 'PermissionDeniedError' ||
        e.message?.includes('PERMISSION_DENIED');

      const isNoDeviceError = e.message?.includes('NO_DEVICE');
      const isApiError = e.message?.includes('API_ERROR');

      if (isPermissionError) {
        setShowPermissionModal(true);
      } else if (isNoDeviceError) {
        alert("Haya couldn't find a microphone. Please make sure your mic is plugged in and recognized by your computer.");
      } else if (isApiError) {
        alert("Haya is having trouble connecting to the AI brain. This usually means the API key is restricted or the service is unavailable in your region.");
      } else {
        console.error("Non-permission error starting session:", e);
      }
      setIsSessionActive(false);
      setAppState("idle");
    } finally {
      // Always release the guard, whether we succeeded or failed.
      isStartingSessionRef.current = false;
    }
  };

  const toggleListening = async () => {
    if (isSessionActive) {
      console.log("[App] Stopping session manually — user pressed End Session.");
      setIsSessionActive(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setAppState("idle");
      resetHayaSession();
    } else {
      await startSession();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];
          setAppState("processing");
          const transcribedText = await transcribeAudio(base64data, 'audio/webm');
          if (transcribedText) {
            setTextInput(prev => (prev + " " + transcribedText).trim());
          }
          setAppState("idle");
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone for transcription.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;

    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  if (!user) {
    return (
      <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-center font-sans relative overflow-hidden">
        <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
        </div>
        <div className="z-10 flex flex-col items-center gap-6 p-8 bg-white/5 border border-white/10 rounded-3xl backdrop-blur-md max-w-md w-full mx-4 text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center font-bold text-2xl shadow-lg shadow-pink-500/20">
            H
          </div>
          <div>
            <h1 className="text-2xl font-serif font-medium mb-2">Welcome to Haya</h1>
            <p className="text-white/60 text-sm">Sign in to sync your chat history and preferences across devices.</p>
          </div>
          <button
            onClick={signInWithGoogle}
            className="w-full py-3 px-4 bg-white text-black font-medium rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal
          onClose={() => setShowPermissionModal(false)}
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center font-bold text-sm">
            H
          </div>
          <h1 className="text-xl font-serif font-medium tracking-wide opacity-90">Haya</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title="Settings & Preferences"
          >
            <Settings size={18} className="opacity-70" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => {
                if (confirm("Are you sure you want to clear the chat history?")) {
                  clearMessages(user.uid);
                  resetHayaSession();
                }
              }}
              className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10"
              title="Clear Chat History"
            >
              <Trash2 size={18} className="opacity-70" />
            </button>
          )}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX size={18} className="opacity-70" />
            ) : (
              <Volume2 size={18} className="opacity-70" />
            )}
          </button>
          <button
            onClick={logOut}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10 ml-2"
            title="Sign Out"
          >
            <LogOut size={18} className="opacity-70" />
          </button>
        </div>
      </header>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl"
            >
              <h2 className="text-xl font-serif font-medium mb-4">Memory & Preferences</h2>
              <p className="text-sm text-white/60 mb-4">
                Haya automatically remembers facts about you. You can also manually add or edit them here.
              </p>

              <div className="space-y-3 mb-6 max-h-60 overflow-y-auto pr-2">
                {Object.entries(preferences).map(([key, value]) => (
                  <div key={key} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={key}
                      readOnly
                      className="w-1/3 bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-white/70 outline-none"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setPreferences(prev => ({ ...prev, [key]: e.target.value }))}
                      className="flex-1 bg-black/50 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-violet-500/50"
                    />
                    <button
                      onClick={() => {
                        const newPrefs = { ...preferences };
                        delete newPrefs[key];
                        setPreferences(newPrefs);
                      }}
                      className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}

                <div className="flex gap-2 items-center mt-2">
                  <input
                    ref={newPrefKeyRef}
                    type="text"
                    placeholder="New Key (e.g., city)"
                    className="w-1/3 bg-black/50 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-violet-500/50"
                  />
                  <input
                    ref={newPrefValueRef}
                    type="text"
                    placeholder="Value"
                    className="flex-1 bg-black/50 border border-white/10 rounded-lg p-2 text-sm text-white outline-none focus:border-violet-500/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const k = newPrefKeyRef.current;
                        const v = newPrefValueRef.current;
                        if (k?.value && v?.value) {
                          setPreferences(prev => ({ ...prev, [k.value]: v.value }));
                          k.value = '';
                          v.value = '';
                        }
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const k = newPrefKeyRef.current;
                      const v = newPrefValueRef.current;
                      if (k?.value && v?.value) {
                        setPreferences(prev => ({ ...prev, [k.value]: v.value }));
                        k.value = '';
                        v.value = '';
                      }
                    }}
                    className="p-2 text-green-400 hover:bg-green-500/20 rounded-lg transition-colors font-bold"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    savePreferences(user.uid, preferences);
                    setShowSettings(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium transition-colors"
                >
                  Save Preferences
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content - Visualizer & Chat */}
      <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12 pointer-events-none">

        {/* Left Column: Haya Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  Replying...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} />
        </div>

        {/* Right Column: User Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </main>

      {/* Controls */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a message to Haya..."
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`p-2 rounded-full transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white/10 hover:bg-white/20 text-white/70'}`}
                title="Hold to transcribe audio"
              >
                <Mic size={16} />
              </button>
              <button
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl
              ${isSessionActive
                ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Mic size={20} className="group-hover:animate-bounce" />
                <span>Start Session</span>
              </>
            )}
          </button>

          {!isSessionActive && (
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl"
              title="Type instead"
            >
              <Keyboard size={20} className="opacity-70" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
