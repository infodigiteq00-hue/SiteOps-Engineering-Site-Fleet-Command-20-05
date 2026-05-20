import emailjs from "@emailjs/browser";

export type InviteEmailPayload = {
  toEmail: string;
  toName: string;
  companyName: string;
  roleLabel: string;
  signupUrl: string;
  contactPhone?: string;
};

export function resolvePublicAppUrl(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

export function resolveSignupUrl(): string {
  const appUrl = resolvePublicAppUrl();
  return appUrl ? `${appUrl}/signup` : "/signup";
}

/** Public URL for the same icon as the app tab (dashboard HardHat tile). Use in EmailJS: <img src="{{logo_url}}" ... /> */
export function resolvePublicLogoUrl(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_LOGO_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  const appUrl = resolvePublicAppUrl();
  if (appUrl) {
    return `${appUrl}/favicon.svg`;
  }
  return "";
}

/**
 * Sends the invite through EmailJS using your dashboard template.
 * Template params include aliases for EmailJS: `name` / `email` match common subjects & "To" fields.
 * Full set: signup_link, user_name, user_email, to_email, name, email, company_name, role, contact_phone, logo_url, app_name
 */
export function isEmailJsConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_EMAILJS_SERVICE_ID &&
      import.meta.env.VITE_EMAILJS_TEMPLATE_ID &&
      import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
  );
}

export async function sendInviteEmail(payload: InviteEmailPayload): Promise<void> {
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID as string | undefined;
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string | undefined;
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string | undefined;
  if (!serviceId || !templateId || !publicKey) {
    throw new Error(
      "EmailJS env missing: set VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID, and VITE_EMAILJS_PUBLIC_KEY.",
    );
  }

  const logoUrl = resolvePublicLogoUrl();

  await emailjs.send(
    serviceId,
    templateId,
    {
      signup_link: payload.signupUrl,
      user_name: payload.toName,
      user_email: payload.toEmail,
      to_email: payload.toEmail,
      /** Aliases for EmailJS "To" / subject lines that use {{email}} / {{name}} */
      email: payload.toEmail,
      name: payload.toName,
      company_name: payload.companyName,
      role: payload.roleLabel,
      contact_phone: payload.contactPhone ?? "",
      logo_url: logoUrl,
      app_name: "SiteOps",
    },
    { publicKey },
  );
}
