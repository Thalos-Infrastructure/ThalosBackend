-- Migration: Create user_wallets table for multi-wallet support
-- This allows users to link multiple wallets (custodial from social login + external wallets)

-- Create user_wallets table
CREATE TABLE IF NOT EXISTS user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  wallet_type TEXT NOT NULL CHECK (wallet_type IN ('custodial', 'freighter', 'lobstr', 'xbull', 'albedo', 'other')),
  label TEXT, -- Optional user-friendly name like "Main Wallet", "Work Wallet"
  is_primary BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Ensure unique wallet per user (same wallet can't be linked twice to same user)
  UNIQUE(user_id, wallet_address)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_wallet_address ON user_wallets(wallet_address);

-- Ensure only one primary wallet per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_primary 
ON user_wallets(user_id) WHERE is_primary = true;

-- Enable RLS
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own wallets"
ON user_wallets FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own wallets"
ON user_wallets FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own wallets"
ON user_wallets FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own wallets"
ON user_wallets FOR DELETE
USING (auth.uid() = user_id);

-- Function to automatically add custodial wallet from auth_users on signup
CREATE OR REPLACE FUNCTION sync_custodial_wallet()
RETURNS TRIGGER AS $$
BEGIN
  -- When auth_users is created/updated with a wallet_public_key, sync to user_wallets
  IF NEW.wallet_public_key IS NOT NULL THEN
    INSERT INTO user_wallets (user_id, wallet_address, wallet_type, is_primary, is_verified, verified_at)
    VALUES (NEW.id, NEW.wallet_public_key, 'custodial', true, true, now())
    ON CONFLICT (user_id, wallet_address) DO UPDATE SET
      is_verified = true,
      verified_at = now(),
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to sync custodial wallets
DROP TRIGGER IF EXISTS trigger_sync_custodial_wallet ON auth_users;
CREATE TRIGGER trigger_sync_custodial_wallet
AFTER INSERT OR UPDATE OF wallet_public_key ON auth_users
FOR EACH ROW EXECUTE FUNCTION sync_custodial_wallet();

-- Backfill existing users' wallets
INSERT INTO user_wallets (user_id, wallet_address, wallet_type, is_primary, is_verified, verified_at)
SELECT id, wallet_public_key, 'custodial', true, true, now()
FROM auth_users
WHERE wallet_public_key IS NOT NULL
ON CONFLICT (user_id, wallet_address) DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE user_wallets IS 'Links multiple Stellar wallets to a single user account. Supports custodial (social login) and external wallets.';
