import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { AddContactDto } from "./dto/add-contact.dto";

@Injectable()
export class ContactsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(userId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from("contacts")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) return { contacts: [], error: error.message };
    return { contacts: data ?? [], error: null };
  }

  async add(userId: string, dto: AddContactDto, appBaseUrl: string) {
    if (dto.email) {
      const { data: existingByEmail } = await this.supabase
        .getClient()
        .from("profiles")
        .select("id, wallet_address")
        .eq("email", dto.email)
        .maybeSingle();

      if (existingByEmail) {
        const { data: contact, error } = await this.supabase
          .getClient()
          .from("contacts")
          .insert({
            user_id: userId,
            contact_user_id: existingByEmail.id,
            name: dto.name,
            email: dto.email,
            wallet_address: existingByEmail.wallet_address,
            status: "active",
          })
          .select()
          .single();

        if (error) {
          return { contact: null, inviteLink: null, error: error.message };
        }
        return { contact, inviteLink: null, error: null };
      }
    }

    const { data: contact, error } = await this.supabase
      .getClient()
      .from("contacts")
      .insert({
        user_id: userId,
        name: dto.name,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        wallet_address: dto.wallet_address ?? null,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      return { contact: null, inviteLink: null, error: error.message };
    }

    const inviteLink = `${appBaseUrl.replace(/\/$/, "")}/invite?ref=${userId}&contact=${contact.id}`;
    return { contact, inviteLink, error: null };
  }

  async remove(userId: string, contactId: string) {
    const { error } = await this.supabase
      .getClient()
      .from("contacts")
      .delete()
      .eq("id", contactId)
      .eq("user_id", userId);

    return { error: error?.message ?? null };
  }
}
