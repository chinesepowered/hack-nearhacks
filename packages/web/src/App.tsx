import { useState } from "react";
import { loadSession, type Session } from "./near";
import { Welcome } from "./ui/Welcome";
import { Game } from "./ui/Game";
import { ToastProvider } from "./ui/Toasts";

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  return (
    <ToastProvider signer={session?.accountId}>
      {session ? <Game session={session} onLeave={() => setSession(null)} /> : <Welcome onJoined={setSession} />}
    </ToastProvider>
  );
}
