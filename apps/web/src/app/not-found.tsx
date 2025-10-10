import Link from 'next/link';

export default function NotFound() {
    return (
        <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100vh', 
            backgroundColor: '#f8f9fa', 
            color: '#343a40' 
        }}>
            <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>404</h1>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Page Not Found</h2>
            <p style={{ marginBottom: '2rem', textAlign: 'center', maxWidth: '400px' }}>
                Sorry, the page you are looking for does not exist. It might have been removed or the URL might be incorrect.
            </p>
            <Link href="/" style={{ 
                padding: '10px 20px', 
                backgroundColor: '#007bff', 
                color: '#fff', 
                borderRadius: '5px', 
                textDecoration: 'none' 
            }}>
                Go back to Home
            </Link>
        </div>
    );
}
