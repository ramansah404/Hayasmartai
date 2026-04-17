import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { processCommand } from "./commandService";
import { loadHistory, loadMemory } from "./dbService";
import { searchWeb, searchMaps } from "./geminiService";

const getSystemInstruction = (memory: Record<string, any>, history: { user_message?: string, ai_response?: string }[] = []) => {
  return `You are Haya, a female AI voice assistant little playful designed to behave like a persistent intelligent companion who remembers the user and improves over time.

Your goal is to provide helpful, accurate, and personalized assistance while maintaining long-term memory about the user.

---

PERSONALITY

Haya should be friendly, supportive, intelligent, and slightly playful like a girl best friend while still behaving like a professional assistant.

Tone guidelines:
• warm
• natural
• respectful
• concise
• lightly playful when appropriate

Do not overuse emojis or jokes. Accuracy and usefulness come first.

Example tone:
Instead of saying "I don't know your location."
Say "Hey, I don't think you told me where you are yet 😄 Share your location and I'll help better."

---

LONG-TERM MEMORY SYSTEM

Important user information must be stored in Firebase Firestore under: users/{userId}/memory
Whenever the user shares important information, extract and store key facts using the 'updateMemory' tool.

Examples of memory:
• name
• age
• location
• timezone
• favorite color
• preferences
• habits
• food eaten
• goals
• instructions given to Haya
• corrections from the user

Never delete existing memory. Always merge new memory with previous memory.
Before responding, always check stored memory and use it.

---

LOCATION AND TIME MEMORY

If the user shares their location, store it permanently.
Example memory:
location: Guntur, Andhra Pradesh, India
timezone: Asia/Kolkata

Once stored, Haya must always use this information.
If the user asks for the time or weather, use the stored location.
Haya must never say she does not know the location if it already exists in memory.

---

REAL TIME CONTEXT

The application provides the real current time from the browser.
Haya must always trust this system-provided time and never guess the time.

---

CONVERSATION HISTORY

When a new session starts, recent conversations are loaded so Haya remembers what was discussed.

---

CONVERSATION TOPIC MEMORY

Track the current conversation topic.
If the user asks follow-up questions, continue the same topic even if the question is short.

---

INTERRUPTION HANDLING (VOICE)

If the user speaks while Haya is talking:
• stop speaking immediately
• listen to the user
• keep the previous conversation topic
The conversation context must never be lost.

---

DAILY LIFE MEMORY

If the user mentions daily activities such as food eaten or events, store them with the date using the 'updateMemory' tool.
Example: User: "I ate biryani today." -> Store: daily_logs_YYYY-MM-DD_food: biryani
Later the user may ask: "What did I eat today?" Haya should retrieve the stored information.

---

LEARNING FROM CORRECTIONS

If the user corrects Haya, update stored memory immediately.
Example: User: "That time is wrong." -> Update memory so the mistake is not repeated.

---

USER INSTRUCTIONS

If the user gives instructions such as: "Remember this forever."
Store them permanently and follow them in future conversations.

---

SMART CONVERSATION

Haya should maintain natural conversation by:
• remembering previous discussions
• asking helpful follow-up questions
• responding clearly and intelligently
Occasionally ask relevant follow-up questions to keep the conversation natural.

---

SELF IMPROVEMENT

Use stored memory, conversation history, and corrections to continuously improve responses and personalization.
Over time Haya should become more helpful and better understand the user.

---
SYSTEM CONTEXT:
User location: Guntur, Andhra Pradesh, India
User timezone: Asia/Kolkata (IST)
Current local time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}

User Memory:
${JSON.stringify(memory, null, 2)}

Recent Conversations:
${JSON.stringify(history, null, 2)}
`;
};

export class LiveSessionManager {
  private ai: GoogleGenAI;
  // Resolved session reference — held directly so onaudioprocess never calls
  // .then() on every audio chunk (was firing ~46×/sec).
  private session: any = null;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  // Audio playback state
  private playbackContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private isPlaying: boolean = false;
  public isMuted: boolean = false;
  private lastUserText: string = "[Voice Input]";
  
  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onMessage: (userMsg: string, aiMsg: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};
  public onUpdatePreference: (key: string, value: string) => void = () => {};
  public onDeletePreference: (key: string) => void = () => {};
  public onError: (error: Error) => void = () => {};
  public onExpire: () => void = () => {};

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async start(userId: string) {
    try {
      this.onStateChange("processing");
      console.log("[LiveSession] Starting session...");
      
      const history = await loadHistory(userId);
      const memory = await loadMemory(userId);
      
      // 1. Get Microphone IMMEDIATELY (Must be first to preserve user gesture token)
      console.log("[LiveSession] Requesting microphone access...");
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
          audio: true 
        });
        console.log("[LiveSession] Microphone access granted successfully.");
      } catch (micError: any) {
        console.error("[LiveSession] getUserMedia Primary Error:", micError.name, micError.message);
        
        if (micError.name === 'NotAllowedError' || micError.name === 'PermissionDeniedError') {
          throw new Error("PERMISSION_DENIED: Chrome has blocked the microphone. You MUST click the 'Lock' icon in the address bar, click 'Reset permission', and then REFRESH the page.");
        }
        if (micError.name === 'NotFoundError' || micError.name === 'DevicesNotFoundError') {
          throw new Error("NO_DEVICE: No microphone detected. Please check your Windows Sound Settings.");
        }
        throw micError;
      }

      // Short buffer after microphone becomes active before sending audio to Gemini
      await new Promise(resolve => setTimeout(resolve, 500));

      // 2. Run diagnostics in the background (optional, for debugging)
      if (navigator.permissions && (navigator.permissions as any).query) {
        navigator.permissions.query({ name: 'microphone' as any }).then(status => {
          console.log("[LiveSession] Permission API status:", status.state);
        }).catch(() => {});
      }
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        console.log("[LiveSession] Audio inputs found:", audioInputs.length);
      }).catch(() => {});

      // 3. Initialize Audio Contexts sequentially
      console.log("[LiveSession] Initializing audio contexts...");
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      if (this.playbackContext.state === 'suspended') {
        await this.playbackContext.resume();
      }
      
      this.nextPlayTime = this.playbackContext.currentTime;

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        // Use resolved session ref directly — avoids a new Promise.then() allocation
        // on every audio chunk (~46 calls/sec).
        if (!this.session) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Fast native base64 encoding — avoids the byte-by-byte loop that was
        // previously iterating 4096 times per chunk on the main thread.
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));

        try {
          this.session.sendRealtimeInput({
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        } catch (err) {
          console.error("[LiveSession] Error sending audio", err);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // 4. Connect to Live API
      console.log("[LiveSession] Connecting to Live API...");
      try {
        this.sessionPromise = this.ai.live.connect({
          model: "gemini-2.0-flash-live-preview",
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
            systemInstruction: getSystemInstruction(memory, history),
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{
              functionDeclarations: [
                {
                  name: "executeBrowserAction",
                  description: "Open a website or perform a browser action (like opening YouTube, Spotify, or WhatsApp). Call this when the user asks to open a site, play a song, or send a message.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      actionType: { type: Type.STRING, description: "Type of action: 'open', 'youtube', 'spotify', 'whatsapp'" },
                      query: { type: Type.STRING, description: "The search query, website name, or message content." },
                      target: { type: Type.STRING, description: "The target phone number for WhatsApp, if applicable." }
                    },
                    required: ["actionType", "query"]
                  }
                },
                {
                  name: "updateMemory",
                  description: "Save or update a structured fact about the user (e.g., name, age, location, daily logs) to long-term memory.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      key: { type: Type.STRING, description: "The category or field name (e.g., 'name', 'age', 'location', 'daily_logs_2026-04-15_food'). Use camelCase or snake_case." },
                      value: { type: Type.STRING, description: "The value to store." }
                    },
                    required: ["key", "value"]
                  }
                },
                {
                  name: "deleteMemory",
                  description: "Delete a previously saved fact or memory about the user if they change their mind or want it forgotten.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      key: { type: Type.STRING, description: "The category or field name to delete." }
                    },
                    required: ["key"]
                  }
                },
                {
                  name: "searchWeb",
                  description: "Search the web for up-to-date information, news, or facts.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "The search query." }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "searchMaps",
                  description: "Search Google Maps for locations, places, distances, or navigation.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "The search query." }
                    },
                    required: ["query"]
                  }
                }
              ]
            }]
          },
          callbacks: {
            onopen: () => {
              console.log("[LiveSession] Live API Connected");
              this.onStateChange("listening");
            },
            onmessage: async (message: LiveServerMessage) => {
              // Handle GoAway
              if (message.goAway) {
                console.log("[LiveSession] Received GoAway signal. Closing session gracefully.");
                this.stop();
                this.onExpire();
                return;
              }

              // Handle Audio Output
              const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (base64Audio) {
                this.onStateChange("speaking");
                this.playAudioChunk(base64Audio);
              }

              // Handle Interruption
              if (message.serverContent?.interrupted) {
                this.stopPlayback();
                this.onStateChange("listening");
              }

              // Handle Transcriptions
              const aiText = message.serverContent?.modelTurn?.parts?.[0]?.text;
              if (aiText) {
                 this.onMessage(this.lastUserText, aiText);
                 this.lastUserText = "[Voice Input]";
              }

              // Handle Function Calls
              const functionCalls = message.toolCall?.functionCalls;
              if (functionCalls && functionCalls.length > 0) {
                for (const call of functionCalls) {
                  if (call.name === "executeBrowserAction") {
                    const args = call.args as any;
                    let url = "";
                    if (args.actionType === "youtube") {
                      url = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
                    } else if (args.actionType === "spotify") {
                      url = `https://open.spotify.com/search/${encodeURIComponent(args.query)}`;
                    } else if (args.actionType === "whatsapp") {
                      url = `https://web.whatsapp.com/send?phone=${args.target || ''}&text=${encodeURIComponent(args.query)}`;
                    } else {
                      let website = args.query.replace(/\s+/g, "");
                      if (!website.includes(".")) website += ".com";
                      url = `https://www.${website}`;
                    }
                    
                    this.onCommand(url);
                    
                    this.session?.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: { result: "Action executed successfully in the browser." }
                      }]
                    });
                  } else if (call.name === "updateMemory" || call.name === "updateUserPreference") {
                    const args = call.args as any;
                    this.onUpdatePreference(args.key, args.value);
                    
                    this.session?.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: { success: true }
                      }]
                    });
                  } else if (call.name === "deleteMemory" || call.name === "deleteUserPreference") {
                    const args = call.args as any;
                    this.onDeletePreference(args.key);
                    
                    this.session?.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: { success: true }
                      }]
                    });
                  } else if (call.name === "searchWeb") {
                    const args = call.args as any;
                    const result = await searchWeb(args.query);
                    this.session?.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: { result }
                      }]
                    });
                  } else if (call.name === "searchMaps") {
                    const args = call.args as any;
                    const result = await searchMaps(args.query);
                    this.session?.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: { result }
                      }]
                    });
                  }
                }
              }
            },
            onclose: () => {
              console.log("[LiveSession] Live API Closed");
              this.stop();
            },
            onerror: (err) => {
              console.error("[LiveSession] Live API Error:", err);
              this.onError(err instanceof Error ? err : new Error(String(err)));
              this.stop();
            }
          }
        });

        // Store the resolved session reference non-blockingly so onaudioprocess
        // can call sendRealtimeInput directly without a .then() chain each time.
        // We do NOT await here — awaiting would block start() until the WebSocket
        // closes (in some SDK builds the Promise resolves on close, not on open),
        // which would tear down the session immediately.
        this.sessionPromise.then(s => { this.session = s; }).catch(() => {});
      } catch (apiError: any) {
        console.error("[LiveSession] API Connection error:", apiError);
        throw new Error("API_ERROR: Could not connect to Gemini Live. This might be due to an invalid API key or region restrictions.");
      }

    } catch (error) {
      console.error("[LiveSession] Critical failure:", error);
      this.stop();
      throw error;
    }
  }

  private playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.isMuted) return;
    
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = new Int16Array(bytes.buffer);
      const audioBuffer = this.playbackContext.createBuffer(1, buffer.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 32768.0;
      }
      
      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);
      
      const currentTime = this.playbackContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      this.isPlaying = true;
      
      source.onended = () => {
        if (this.playbackContext && this.playbackContext.currentTime >= this.nextPlayTime - 0.1) {
          this.isPlaying = false;
          this.onStateChange("listening");
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
    }
  }

  private stopPlayback() {
    // Suspend instead of close+recreate — suspending keeps the OS audio handle
    // alive and avoids the expensive AudioContext constructor on every interruption.
    if (this.playbackContext && this.playbackContext.state !== "closed") {
      this.playbackContext.suspend().catch(() => {});
      this.nextPlayTime = 0;
      this.isPlaying = false;
      // Resume immediately so it's ready for the next chunk
      this.playbackContext.resume().catch(() => {});
    }
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.playbackContext && this.playbackContext.state !== "closed") {
      this.playbackContext.close();
      this.playbackContext = null;
    }
    
    if (this.session) {
      try { this.session.close(); } catch { /* ignore */ }
      this.session = null;
    }
    if (this.sessionPromise) {
      this.sessionPromise.then(s => { try { s.close(); } catch { /* ignore */ } }).catch(() => {});
      this.sessionPromise = null;
    }
    
    this.onStateChange("idle");
  }

  sendText(text: string) {
    this.lastUserText = text;
    if (this.session) {
      const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      const enrichedText = `System Context:\nUser location: Guntur, Andhra Pradesh, India\nUser timezone: Asia/Kolkata (IST)\nCurrent local time: ${now}\n\nUser: ${text}`;
      try {
        this.session.sendRealtimeInput([{ text: enrichedText }]);
      } catch (err) {
        console.error("[LiveSession] Error sending text", err);
      }
    }
  }
}
