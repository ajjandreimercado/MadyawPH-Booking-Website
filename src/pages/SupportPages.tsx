import { Link } from 'react-router-dom';

type InfoSection = { heading: string; body: string };

function InfoPage({
  eyebrow,
  title,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  sections: InfoSection[];
}) {
  return (
    <div className="min-h-screen bg-brand-background pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <section className="bg-brand-cream border border-brand-primary/10 rounded-[2rem] p-8 sm:p-10 shadow-md">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark/60">{eyebrow}</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-serif font-bold text-brand-dark">{title}</h1>
          <p className="mt-4 text-sm sm:text-base text-brand-dark/70 leading-relaxed">{intro}</p>
          <div className="mt-8 space-y-6">
            {sections.map((section) => (
              <div key={section.heading}>
                <h2 className="text-lg font-serif font-bold text-brand-dark mb-2">{section.heading}</h2>
                <p className="text-sm text-brand-dark/70 leading-relaxed whitespace-pre-line">{section.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link
              to="/"
              className="inline-flex items-center px-7 py-3 bg-brand-primary text-brand-cream text-xs font-bold uppercase tracking-[0.18em] rounded-xl hover:bg-brand-hover transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

export function HelpCenterPage() {
  return (
    <InfoPage
      eyebrow="Support"
      title="Help Center"
      intro="Madyaw is a guest booking-request website. Hotels confirm your stay in their management app and contact you by email."
      sections={[
        {
          heading: 'How booking works',
          body: 'Search for a hotel or room, submit a reservation request with your details and the hotel’s required online payment (half or full), then wait for the hotel to accept. Confirmation and room assignment are handled by the hotel — not on this website.',
        },
        {
          heading: 'Online payment',
          body: 'Each partner hotel chooses whether online bookings require a 50% deposit or full payment. The remaining balance (if any) is collected when you check out at the hotel.',
        },
        {
          heading: 'Valid ID',
          body: 'Upload a clear photo or PDF of a government ID with your request. The hotel uses it to verify your reservation.',
        },
        {
          heading: 'Need help with a stay?',
          body: 'Contact the hotel directly using the phone number on the hotel page, or reply to the email they send after reviewing your request.',
        },
      ]}
    />
  );
}

export function CancellationPage() {
  return (
    <InfoPage
      eyebrow="Support"
      title="Cancellation Options"
      intro="Cancellation rules depend on each hotel’s policy. Madyaw submits your request; the hotel manages accept, decline, and cancellation in their app."
      sections={[
        {
          heading: 'Before the hotel accepts',
          body: 'If your request is still pending, contact the hotel as soon as possible using the details on their listing so they can cancel or ignore the request.',
        },
        {
          heading: 'After acceptance',
          body: 'Once the hotel accepts, their cancellation and refund rules apply (including any free-cancellation window shown on the listing). Reach out to the hotel for changes.',
        },
        {
          heading: 'Deposits',
          body: 'Any deposit or balance handling after acceptance is managed by the hotel at check-in / check-out.',
        },
      ]}
    />
  );
}

export function SafetyPage() {
  return (
    <InfoPage
      eyebrow="Support"
      title="Safety Information"
      intro="We want every Madyaw guest stay to feel secure — online and on property."
      sections={[
        {
          heading: 'Your data',
          body: 'Booking details and your Valid ID are stored for the hotel that will host you. Do not upload IDs that are not yours.',
        },
        {
          heading: 'Payments',
          body: 'This website records the hotel’s required online payment (half deposit or full stay). Follow only payment instructions that come from the hotel after they accept your request.',
        },
        {
          heading: 'On property',
          body: 'Follow hotel house rules, keep valuables secure, and use official hotel contacts if anything feels wrong during your stay.',
        },
      ]}
    />
  );
}

export function ContactPage() {
  return (
    <InfoPage
      eyebrow="Support"
      title="Contact Us"
      intro="For a specific reservation, the hotel is your primary contact. For website questions about searching or submitting a request, use the channels below."
      sections={[
        {
          heading: 'Hotel reservations',
          body: 'Open your hotel’s page on Madyaw and use the listed phone number, or reply to the email the hotel sends after reviewing your request.',
        },
        {
          heading: 'Website support',
          body: 'Email: support@madyaw.ph\nWe respond to guest website questions about search, booking requests, and account-free checkout.',
        },
      ]}
    />
  );
}

export function PrivacyPolicyPage() {
  return (
    <InfoPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="This policy explains how the Madyaw guest booking website handles information you submit when requesting a stay."
      sections={[
        {
          heading: 'What we collect',
          body: 'Name, email, phone, stay dates, guest counts, payment preference, optional notes, and a Valid ID file for hotel verification.',
        },
        {
          heading: 'How it is used',
          body: 'We create a booking request in the shared hotel database so the property can review, confirm, and host you. We do not sell your personal data.',
        },
        {
          heading: 'Sharing',
          body: 'Your request (including Valid ID) is available to the hotel you selected through their management app connected to the same database.',
        },
        {
          heading: 'Retention',
          body: 'Hotels retain booking records according to their operational and legal needs. Contact the hotel for deletion or correction of stay records after acceptance.',
        },
      ]}
    />
  );
}

export function TermsOfServicePage() {
  return (
    <InfoPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="By using the Madyaw guest booking website, you agree to submit accurate information and understand that hotels confirm stays separately."
      sections={[
        {
          heading: 'Guest booking requests only',
          body: 'This site lets guests search and request rooms. Hotel acceptance, inventory, emails, and check-out payments are handled by the hotel’s own app and staff.',
        },
        {
          heading: 'Accuracy',
          body: 'You are responsible for correct dates, guest counts, contact details, and a legitimate Valid ID upload.',
        },
        {
          heading: 'Pricing',
          body: 'Displayed rates are estimates based on the selected room. Final charges, taxes, and remaining balance follow the hotel’s policies.',
        },
        {
          heading: 'Limitation',
          body: 'Madyaw is not liable for hotel decisions to accept, decline, or modify a reservation, or for services delivered on property.',
        },
      ]}
    />
  );
}
