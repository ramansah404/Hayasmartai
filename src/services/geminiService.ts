import { GoogleGenAI, Type } from "@google/genai";
import { loadHistory, loadMemory } from "./dbService";

// ── Singleton client ────────────────────────────────────────────────────────
// Created once at module load; avoids re-initialising the SDK HTTP client on
// every function call (was happening in searchWeb, searchMaps, transcribeAudio,
// getHayaAudio, and getHayaResponse individually).
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── System instruction builder ──────────────────────────────────────────────
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

let chatSession: any = null;

export function resetHayaSession() {
  chatSession = null;
}

export async function searchWeb(query: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: query,
      tools: [{ googleSearch: {} }]
    });
    return response.text || "No results found.";
  } catch (e) {
    console.error("Web Search Error:", e);
    return "Failed to search the web.";
  }
}

export async function searchMaps(query: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: query,
      tools: [{ googleMaps: {} }]
    });
    return response.text || "No results found.";
  } catch (e) {
    console.error("Maps Search Error:", e);
    return "Failed to search maps.";
  }
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        { inlineData: { data: audioBase64, mimeType } },
        "Transcribe the audio exactly as spoken. Do not add any additional text."
      ]
    });
    return response.text || "";
  } catch (e) {
    console.error("Transcription Error:", e);
    return "";
  }
}

export async function getHayaResponse(userId: string, prompt: string, onUpdatePreference?: (key: string, value: string) => void, onDeletePreference?: (key: string) => void): Promise<string> {
  try {
    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const enrichedPrompt = `System Context:\nUser location: Guntur, Andhra Pradesh, India\nUser timezone: Asia/Kolkata (IST)\nCurrent local time: ${now}\n\nUser: ${prompt}`;
    
    if (!chatSession) {
      const history = await loadHistory(userId);
      const memory = await loadMemory(userId);
      
      chatSession = ai.chats.create({
        model: "gemini-2.0-flash-lite",
        config: {
          systemInstruction: getSystemInstruction(memory, history),
          tools: [{
            functionDeclarations: [
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
        }
      });
    }

    let response = await chatSession.sendMessage(enrichedPrompt);
    
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        if (call.name === "updateMemory" || call.name === "updateUserPreference") {
          const { key, value } = call.args as any;
          if (onUpdatePreference) onUpdatePreference(key, value);
          
          response = await chatSession.sendMessage([{
            functionResponse: {
              name: call.name,
              response: { success: true, updatedKey: key, updatedValue: value }
            }
          }]);
        } else if (call.name === "deleteMemory" || call.name === "deleteUserPreference") {
          const { key } = call.args as any;
          if (onDeletePreference) onDeletePreference(key);
          
          response = await chatSession.sendMessage([{
            functionResponse: {
              name: call.name,
              response: { success: true, deletedKey: key }
            }
          }]);
        } else if (call.name === "searchWeb") {
          const { query } = call.args as any;
          const searchResult = await searchWeb(query);
          response = await chatSession.sendMessage([{
            functionResponse: {
              name: call.name,
              response: { result: searchResult }
            }
          }]);
        } else if (call.name === "searchMaps") {
          const { query } = call.args as any;
          const searchResult = await searchMaps(query);
          response = await chatSession.sendMessage([{
            functionResponse: {
              name: call.name,
              response: { result: searchResult }
            }
          }]);
        }
      }
    }

    return response.text || "I'm not sure what to say.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "I'm having some trouble connecting right now. Please try again later.";
  }
}

export async function getHayaAudio(text: string): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}
