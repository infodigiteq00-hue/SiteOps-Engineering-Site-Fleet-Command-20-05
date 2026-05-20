import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight, HardHat, MapPinned, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { resolvePublicAppUrl } from "@/lib/sendInviteEmail";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

const benefitRows = [
  {
    icon: Wrench,
    title: "No more duplicate purchases",
    body: "See what already exists across sites before you buy.",
  },
  {
    icon: MapPinned,
    title: "No more lost machinery",
    body: "Live allocation, movement, and site status in one thread.",
  },
  {
    icon: ShieldCheck,
    title: "No more “who took it?” chaos",
    body: "Structured approvals and a full audit ledger.",
  },
] as const;

const Login = () => {
  const { isSupabaseEnabled, session, authReady } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const emailInputRef = useRef<HTMLInputElement>(null);
  const signInSectionRef = useRef<HTMLElement>(null);

  const [authTab, setAuthTab] = useState<"sign-in" | "create" | "forgot">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  const focusSignIn = useCallback(() => {
    setAuthTab("sign-in");
    signInSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.requestAnimationFrame(() => {
      emailInputRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (searchParams.get("auth") !== "login") return;
    focusSignIn();
    const next = new URLSearchParams(searchParams);
    next.delete("auth");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, focusSignIn]);

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 p-6">
        <Card className="w-full max-w-xl border-blue-900/40 bg-card/95 shadow-2xl">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Configuration required</CardTitle>
            <CardDescription>
              Connect Supabase before using Command Center authentication.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Set <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">VITE_SUPABASE_URL</code> and{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">VITE_SUPABASE_ANON_KEY</code> in your environment (for example{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">.env.local</code>), then restart the dev server.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authReady && session) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (error) {
      toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Signed in" });
  };

  const onSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupSubmitting(true);
    const appUrl = resolvePublicAppUrl();
    const { data, error } = await supabase.auth.signUp({
      email: signupEmail.trim(),
      password: signupPassword,
      options: {
        emailRedirectTo: `${appUrl}/`,
        data: { full_name: fullName.trim() },
      },
    });
    setSignupSubmitting(false);
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

  const onForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast({ title: "Email required", description: "Enter the email for your account.", variant: "destructive" });
      return;
    }
    setForgotSubmitting(true);
    const appUrl = resolvePublicAppUrl();
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${appUrl}/reset-password`,
    });
    setForgotSubmitting(false);
    if (error) {
      toast({ title: "Could not send reset email", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Check your email",
      description: "If an account exists for that address, you will receive a link to reset your password.",
    });
    setAuthTab("sign-in");
  };

  const inputPremium =
    "h-11 rounded-xl border-slate-200/90 bg-white/90 px-3.5 text-[0.9375rem] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow] placeholder:text-slate-400 focus-visible:border-blue-500/45 focus-visible:ring-2 focus-visible:ring-blue-500/15 focus-visible:ring-offset-0 md:text-[0.9375rem]";

  return (
    <div className="min-h-screen bg-blue-950 text-slate-900">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* —— Left: narrative —— */}
        <div className="relative order-2 flex min-h-[52vh] flex-col justify-between overflow-hidden border-b border-blue-950/50 bg-gradient-to-b from-[#0f172a] via-[#172554] to-[#1c2f5e] px-6 py-8 sm:px-10 sm:py-10 lg:order-1 lg:min-h-screen lg:border-b-0 lg:border-r lg:border-blue-950/45 lg:px-12 lg:py-14 xl:px-16 xl:py-16">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute -left-1/4 top-0 h-[min(85%,32rem)] w-[min(140%,42rem)] rounded-full bg-blue-600/[0.045] blur-[100px] motion-safe:animate-glow-drift motion-reduce:animate-none" />
            <div className="absolute bottom-0 right-0 h-[min(70%,24rem)] w-[min(90%,28rem)] translate-x-1/4 translate-y-1/4 rounded-full bg-blue-950/45 blur-[90px] motion-safe:animate-glow-drift-slow motion-reduce:animate-none" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_50%_at_50%_0%,rgba(30,58,138,0.12),transparent_56%)]" />
            <div className="absolute inset-0 bg-slate-950/30" />
          </div>

          <div className="relative z-10 flex flex-col gap-8 lg:max-w-xl lg:gap-10 xl:max-w-2xl xl:gap-11">
            <div
              className={cn(
                "flex items-center gap-3 sm:gap-3.5",
                "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700 motion-safe:fill-mode-both",
                "motion-reduce:animate-none motion-reduce:opacity-100",
              )}
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white shadow-lg shadow-blue-950/30 sm:h-11 sm:w-11">
                <HardHat className="h-[1.125rem] w-[1.125rem] sm:h-6 sm:w-6" aria-hidden strokeWidth={1.75} />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="font-display text-base font-semibold tracking-tight text-white sm:text-[1.0625rem]">SiteManager</p>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-400 sm:text-xs">Inventory management platform</p>
              </div>
            </div>

            <div>
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-blue-200/90 backdrop-blur-md",
                  "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-700 motion-safe:delay-75 motion-safe:fill-mode-both",
                  "motion-reduce:animate-none motion-reduce:opacity-100",
                )}
              >
                <Sparkles className="h-3 w-3 text-blue-300" aria-hidden />
                Operations control
              </div>

              <h1
                id="hero-heading"
                className="mt-6 font-display text-[1.85rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl sm:leading-[1.07] lg:text-[2.35rem] xl:text-5xl xl:leading-[1.06]"
              >
                <span
                  className={cn(
                    "block",
                    "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:delay-100 motion-safe:fill-mode-both motion-safe:ease-out",
                    "motion-reduce:animate-none motion-reduce:opacity-100",
                  )}
                >
                  Instant machinery visibility
                </span>
                <span
                  className={cn(
                    "mt-1 block bg-gradient-to-r from-blue-200 via-sky-100 to-white bg-clip-text text-transparent sm:mt-1.5",
                    "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:delay-150 motion-safe:fill-mode-both motion-safe:ease-out",
                    "motion-reduce:animate-none motion-reduce:opacity-100",
                  )}
                >
                  across every site.
                </span>
              </h1>

              <p
                className={cn(
                  "mt-5 max-w-md text-[0.9375rem] leading-relaxed text-slate-400 sm:text-base lg:text-[1.05rem]",
                  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700 motion-safe:delay-200 motion-safe:fill-mode-both motion-safe:ease-out",
                  "motion-reduce:animate-none motion-reduce:opacity-100",
                )}
              >
                Track every machine, approval, and movement in one command layer. No more call chains, spreadsheets, or WhatsApp confusion.
              </p>

              <div
                className={cn(
                  "mt-7",
                  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700 motion-safe:delay-260 motion-safe:fill-mode-both motion-safe:ease-out",
                  "motion-reduce:animate-none motion-reduce:opacity-100",
                )}
              >
                <Button
                  asChild
                  size="lg"
                  className="h-11 rounded-xl bg-white px-5 font-medium text-slate-900 shadow-lg shadow-black/20 transition-[transform,box-shadow] hover:bg-slate-100 hover:shadow-xl"
                >
                  <a href="mailto:demo@siteops.app?subject=Command%20Center%20Demo%20Request">
                    Request demo
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>

            <ul
              className="relative z-10 mt-1 max-w-[19.5rem] space-y-2 sm:max-w-md sm:space-y-2.5 lg:mt-2"
              aria-label="Key outcomes"
            >
              {benefitRows.map(({ icon: Icon, title, body }, i) => (
                <li
                  key={title}
                  className={cn(
                    "flex gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.025] p-2.5 backdrop-blur-sm transition-[border-color,background-color] duration-300 sm:gap-3 sm:p-3",
                    "hover:border-white/[0.08] hover:bg-white/[0.04]",
                    "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:ease-out",
                    "motion-reduce:animate-none motion-reduce:opacity-100",
                    i === 0 && "motion-safe:delay-300",
                    i === 1 && "motion-safe:delay-360",
                    i === 2 && "motion-safe:delay-[420ms]",
                  )}
                >
                  <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-200/90">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                  </span>
                  <div className="min-w-0 py-px">
                    <p className="font-display text-[12px] font-medium leading-snug tracking-tight text-white/95 sm:text-[13px]">{title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400/90 sm:text-xs">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* —— Right: auth —— */}
        <section
          ref={signInSectionRef}
          id="sign-in"
          className="relative order-1 flex flex-col justify-center bg-gradient-to-b from-slate-50 via-white to-slate-100/90 px-5 py-10 sm:px-10 sm:py-12 lg:order-2 lg:px-14 xl:px-20"
          aria-labelledby="auth-panel-heading"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="absolute right-0 top-1/4 h-64 w-64 rounded-full bg-blue-400/[0.07] blur-3xl" />
            <div className="absolute bottom-1/4 left-0 h-48 w-48 rounded-full bg-slate-300/30 blur-3xl" />
          </div>

          <div className="relative z-10 mx-auto w-full max-w-[22rem] sm:max-w-md">
            <header
              className={cn(
                "mb-6 sm:mb-7",
                "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700 motion-safe:fill-mode-both",
                "motion-reduce:animate-none motion-reduce:opacity-100",
              )}
            >
              <h2 id="auth-panel-heading" className="font-display text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {authTab === "forgot" ? "Reset password" : "Sign in to SiteManager"}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                {authTab === "forgot"
                  ? "We will email you a link to choose a new password."
                  : authTab === "sign-in"
                    ? "Use your assigned credentials."
                    : "Use the same work email your admin invited. Access is applied from that invitation."}
              </p>
            </header>

            {authTab !== "forgot" && (
              <div
                className={cn(
                  "mb-6 flex rounded-xl bg-slate-200/70 p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] sm:mb-7",
                  "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700 motion-safe:delay-75 motion-safe:fill-mode-both",
                  "motion-reduce:animate-none motion-reduce:opacity-100",
                )}
                role="tablist"
                aria-label="Authentication"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={authTab === "sign-in"}
                  id="tab-sign-in"
                  aria-controls="auth-tab-panel"
                  className={cn(
                    "relative flex-1 rounded-lg py-2.5 text-sm font-medium transition-[color,box-shadow,background-color] duration-200",
                    authTab === "sign-in"
                      ? "bg-white text-slate-900 shadow-sm shadow-slate-900/5"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                  onClick={() => setAuthTab("sign-in")}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authTab === "create"}
                  id="tab-create"
                  aria-controls="auth-tab-panel"
                  className={cn(
                    "relative flex-1 rounded-lg py-2.5 text-sm font-medium transition-[color,box-shadow,background-color] duration-200",
                    authTab === "create"
                      ? "bg-white text-slate-900 shadow-sm shadow-slate-900/5"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                  onClick={() => setAuthTab("create")}
                >
                  Create account
                </button>
              </div>
            )}

            <div
              id="auth-tab-panel"
              role="tabpanel"
              aria-labelledby={
                authTab === "forgot" ? "auth-panel-heading" : authTab === "sign-in" ? "tab-sign-in" : "tab-create"
              }
              className={cn(
                "rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.2),0_0_0_1px_rgba(255,255,255,0.8)_inset] backdrop-blur-xl sm:p-8",
                "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-700 motion-safe:delay-100 motion-safe:fill-mode-both motion-safe:ease-out",
                "motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:scale-100",
              )}
            >
              <div className="mb-6 flex justify-center sm:mb-7">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 shadow-lg shadow-slate-900/20">
                  <HardHat className="h-5 w-5 text-white" aria-hidden strokeWidth={1.5} />
                </div>
              </div>

              {authTab === "sign-in" ? (
                <form onSubmit={onSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="text-xs font-medium text-slate-600">
                      Email
                    </Label>
                    <Input
                      ref={emailInputRef}
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={!isSupabaseEnabled}
                      className={inputPremium}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="login-password" className="text-xs font-medium text-slate-600">
                        Password
                      </Label>
                      <button
                        type="button"
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={() => setAuthTab("forgot")}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className={inputPremium}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="mt-2 h-11 w-full rounded-xl bg-slate-900 text-[0.9375rem] font-medium shadow-lg shadow-slate-900/15 transition-[transform,box-shadow] hover:bg-slate-800 hover:shadow-xl"
                    disabled={submitting || !isSupabaseEnabled}
                  >
                    {submitting ? "Signing in…" : "Continue"}
                  </Button>
                </form>
              ) : authTab === "forgot" ? (
                <form onSubmit={onForgotSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email" className="text-xs font-medium text-slate-600">
                      Email
                    </Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={!isSupabaseEnabled}
                      className={inputPremium}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="mt-2 h-11 w-full rounded-xl bg-slate-900 text-[0.9375rem] font-medium shadow-lg shadow-slate-900/15 transition-[transform,box-shadow] hover:bg-slate-800 hover:shadow-xl"
                    disabled={forgotSubmitting || !isSupabaseEnabled}
                  >
                    {forgotSubmitting ? "Sending…" : "Send reset link"}
                  </Button>
                  <button
                    type="button"
                    className="w-full text-center text-sm text-slate-500 hover:text-slate-800"
                    onClick={() => setAuthTab("sign-in")}
                  >
                    Back to sign in
                  </button>
                </form>
              ) : (
                <form onSubmit={onSignupSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="signup-fullName" className="text-xs font-medium text-slate-600">
                      Full name
                    </Label>
                    <Input
                      id="signup-fullName"
                      type="text"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      className={inputPremium}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-xs font-medium text-slate-600">
                      Email
                    </Label>
                    <Input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                      className={inputPremium}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-xs font-medium text-slate-600">
                      Password
                    </Label>
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                      minLength={6}
                      className={inputPremium}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="mt-2 h-11 w-full rounded-xl bg-slate-900 text-[0.9375rem] font-medium shadow-lg shadow-slate-900/15 transition-[transform,box-shadow] hover:bg-slate-800 hover:shadow-xl"
                    disabled={signupSubmitting}
                  >
                    {signupSubmitting ? "Creating account…" : "Create account"}
                  </Button>
                </form>
              )}
            </div>

            <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400 sm:mt-10">
              By continuing you agree to your organization&apos;s access policies.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Login;
