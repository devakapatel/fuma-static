-- Remove donation payment data after donations were discontinued.
DELETE FROM payment_intents
WHERE purpose = 'donation';