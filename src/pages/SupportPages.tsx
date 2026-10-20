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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-primary">{eyebrow}</p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-display font-semibold text-brand-dark">{title}</h1>
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
          body: 'Search for a hotel, choose a room type, enter your details and Valid ID, then pay the full stay by scanning the hotel’s GCash or Maya QR and upload your receipt. The hotel verifies your payment and confirms your stay by email. The hotel assigns your room.',
        },
        {
          heading: 'Online payment',
          body: 'You pay the full stay total when you book, using the hotel’s own GCash or Maya QR shown at the last step. Upload the receipt screenshot; the hotel verifies it in their system.',
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
      title="Cancellation Policy"
      intro="All bookings made on Madyaw are non-refundable."
      sections={[
        {
          heading: 'Non-refundable bookings',
          body: 'You pay the full stay when you book. That payment can’t be refunded if you cancel, change your dates, shorten your stay or don’t arrive. Please check your dates, room and details before you pay.',
        },
        {
          heading: 'If the hotel can’t confirm your booking',
          body: 'If the hotel declines or cancels your booking, you get your payment back in full. The hotel emails you and arranges the refund; reply to that email or call the hotel if you have questions.',
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
          body: 'This website records full stay payment after hotel confirmation. Follow only payment instructions from the secure email link after they accept your request.',
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
