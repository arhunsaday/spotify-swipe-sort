import { useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/useAuthStore";
import { getClientId, redirectUri, setClientId } from "@/auth/pkce";

export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const [clientId, setId] = useState(getClientId());
  const [copied, setCopied] = useState(false);
  const uri = redirectUri();

  const onLogin = () => {
    if (!clientId.trim()) return;
    setClientId(clientId);
    void login();
  };

  const copy = () => {
    navigator.clipboard.writeText(uri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <img
            src="/icon.png"
            alt="Swiper"
            className="mb-2 h-12 w-12 rounded-xl drag-none"
            draggable={false}
          />
          <CardTitle>Spotify Swipe Sort</CardTitle>
          <CardDescription>
            Fast, keyboard-driven playlist triage. Runs entirely in your browser
            (PKCE, no backend). Requires Spotify Premium.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cid">Spotify Client ID</Label>
            <Input
              id="cid"
              value={clientId}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onLogin()}
              placeholder="paste your app's Client ID"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Redirect URI to register (exactly)</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs">
                {uri}
              </code>
              <Button variant="outline" size="icon-sm" onClick={copy}>
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              In your{" "}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Spotify dashboard
              </a>
              : add this redirect URI, and add your account under User
              Management (dev-mode allowlist).
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            className="w-full"
            onClick={onLogin}
            disabled={!clientId.trim()}
          >
            Log in with Spotify
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
