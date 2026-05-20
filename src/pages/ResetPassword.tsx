import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HardHat } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

/**
 * Landing page for Supabase password recovery. Add this URL to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs:
 * e.g. https://your-domain.com/reset-password
 */
const ResetPassword = () => {
  const navigate = useNavigate();
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const markHydrated = () => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setHydrated(true);
  };

  useEffect(() => {
    const href = typeof window !== "undefined" ? window.location.href : "";
    const u = href ? new URL(href) : null;
    const hash = u?.hash ?? "";
    const looksLikeRecovery =
      hash.includes("type=recovery") || u?.searchParams.get("type") === "recovery";
    if (looksLikeRecovery) {
      setRecoveryMode(true);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
      }
      markHydrated();
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && looksLikeRecovery) {
        setRecoveryMode(true);
      }
      markHydrated();
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 via-slate-900 to-slate-950 p-6">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Configure Supabase environment variables before using password reset.
        </p>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Mismatch", description: "Passwords do not match.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast({ title: "Could not update password", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Password updated", description: "You are signed in. Redirecting…" });
    navigate("/", { replace: true });
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 via-slate-900 to-slate-950 p-6 text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!recoveryMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 via-slate-900 to-slate-950 p-6">
        <Card className="w-full max-w-md border-blue-900/50 bg-card/95 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700">
              <HardHat className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="font-display text-xl">Reset link invalid or expired</CardTitle>
            <CardDescription>Request a new link from the sign-in page.</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild variant="secondary">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 via-slate-900 to-slate-950 p-6">
      <Card className="w-full max-w-md border-blue-900/50 bg-card/95 shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700">
            <HardHat className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="font-display text-2xl">Set new password</CardTitle>
          <CardDescription>Choose a new password for your account.</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Saving…" : "Update password"}
            </Button>
            <Link to="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
              Cancel and return to sign in
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default ResetPassword;
