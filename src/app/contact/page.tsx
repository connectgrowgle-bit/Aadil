import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact" };

// A real submit handler (writing to crm_contacts / support_tickets) is
// Phase 7/CRM territory and is not wired up yet — see STATUS.md. The form
// renders but does not currently persist a submission.
export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Contact us</h1>
      <p className="mt-2 text-gray-600">Tell us about your project and we&apos;ll get back to you.</p>
      <form className="mt-8 space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium text-gray-700">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            rows={5}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled
          title="Not yet wired to the CRM — see STATUS.md"
          className="rounded-md bg-gray-300 px-6 py-3 text-sm font-medium text-gray-600"
        >
          Send message (coming soon)
        </button>
      </form>
    </div>
  );
}
