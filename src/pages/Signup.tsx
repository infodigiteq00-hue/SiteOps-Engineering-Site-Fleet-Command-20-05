import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { HardHat } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { resolvePublicAppUrl } from "@/lib/sendInviteEmail";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

const Signup = () => {
  const { session, authReady } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-950 via-slate-900 to-slate-950 p-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          Configure <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">VITE_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">VITE_SUPABASE_ANON_KEY</code> before signing up.
        </p>
      </div>
    );
  }

  if (authReady && session) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const appUrl = resolvePublicAppUrl();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${appUrl}/`,
        data: { full_name: fullName.trim() },
      },
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
      return;
    }
    if (data.user && !data.session) {
      toast({
        title: "Check your email",
        description: "Confirm your address to finish sign-up (if email confirmations are enabled in Supabase).",
      });
      return;
    }
    toast({ title: "Account created", description: "You are signed in." });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 via-slate-900 to-slate-950 p-6">
      <Card className="w-full max-w-md border-blue-900/50 bg-card/95 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700">
            <HardHat className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="font-display text-2xl">Create account</CardTitle>
          <CardDescription>
            Use the <strong>same email</strong> as on your invitation (Firm Admin invite from Platform, or team invite from <strong>Team</strong>). After you confirm the Supabase email, sign in to get the role stored in{" "}
            <span className="font-mono text-xs">company_invites</span>. If you were not invited, you are created as Firm Admin without a company until a Super Admin assigns you.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating account…" : "Sign up"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login?auth=login" className="font-medium text-primary underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default Signup;
