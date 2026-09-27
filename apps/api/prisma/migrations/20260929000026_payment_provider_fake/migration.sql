-- Payments made on the built in test page are stored as provider "fake", not "moyasar".
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'fake';
