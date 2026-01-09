# A/B Testing Security Improvements

## Overview

This document outlines the security improvements made to the A/B testing system's hash function to prevent gaming of experiment assignments.

## Problem Statement

The original implementation used a simple DJB2 hash function that was:
- **Predictable**: Attackers could reverse-engineer the algorithm
- **Gameable**: Users could manipulate their IDs to get desired variants
- **Collision-prone**: High likelihood of hash collisions
- **Not cryptographically secure**: Vulnerable to various attacks

## Solution

### Primary Implementation: SHA-256

The new implementation uses the Web Crypto API's SHA-256 algorithm:

```typescript
// Cryptographically secure hash using SHA-256
const hashBuffer = await crypto.subtle.digest('SHA-256', data);
```

**Benefits:**
- **Cryptographically secure**: Cannot be reverse-engineered
- **Deterministic**: Same input always produces same output
- **Uniform distribution**: Fair variant assignment
- **Non-gameable**: Users cannot predict or manipulate outcomes
- **Avalanche effect**: Small input changes produce completely different outputs

### Fallback: FNV-1a Algorithm

For environments without `crypto.subtle` (rare), we provide an FNV-1a fallback:
- Better distribution than DJB2
- Additional mixing steps for improved randomness
- Still deterministic
- While not cryptographically secure, significantly better than the original

## Technical Details

### Hash Function Properties

1. **Deterministic Behavior**
   - Same user + experiment always gets same variant
   - Ensures consistent user experience

2. **Uniform Distribution**
   - ~50/50 split for control/treatment
   - Fair traffic allocation

3. **Security Features**
   - SHA-256 provides 256 bits of entropy
   - We use first 8 bytes (64 bits) for numeric conversion
   - Maintains JavaScript safe integer range
   - Modulo with large prime (1000000007) for overflow handling

### Migration Impact

The change makes `assignVariant` async:

```typescript
// Before
const result = abTestingEngine.assignVariant(experiment);

// After
const result = await abTestingEngine.assignVariant(experiment);
```

**Important:** Existing variant assignments are preserved. Users already in experiments will keep their variants.

## Security Testing

The implementation includes comprehensive security tests:

1. **Determinism Test**: Verifies same input produces same output
2. **Avalanche Effect Test**: Small changes produce large differences
3. **Distribution Test**: Validates uniform variant assignment
4. **Non-Predictability Test**: Sequential users get random assignments
5. **Gaming Resistance Test**: Common patterns don't reveal exploits
6. **Performance Test**: Handles large inputs efficiently

## Best Practices

1. **Never expose internal hashing logic** to client-side code
2. **Use server-side validation** for critical experiments
3. **Monitor for anomalies** in variant distribution
4. **Regularly rotate** experiment IDs to prevent long-term attacks
5. **Implement rate limiting** for experiment assignment requests

## Compliance

This implementation helps meet security requirements for:
- **GDPR**: User data is hashed, not stored in plain text
- **SOC 2**: Cryptographic controls for data integrity
- **OWASP**: Follows secure random number generation guidelines

## Performance Considerations

- SHA-256 computation: < 1ms for typical inputs
- Async operation: Minimal impact due to fast execution
- Caching: Existing assignments are cached, no re-computation
- Fallback: FNV-1a is even faster if crypto.subtle unavailable

## Monitoring

Watch for:
- Unusual distribution patterns (deviation from expected split)
- High frequency of assignment requests from single users
- Attempts to manipulate user IDs
- Performance degradation in hash computation

## References

- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [SHA-256](https://en.wikipedia.org/wiki/SHA-2)
- [FNV Hash](http://www.isthe.com/chongo/tech/comp/fnv/)
- [OWASP Random Number Generation](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)