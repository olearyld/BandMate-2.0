export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cities: {
        Row: {
          city: string
          created_at: string
          id: string
          lat: number
          lng: number
          state: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          lat: number
          lng: number
          state: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          state?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          body: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "media_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          created_at: string
          id: string
          recipient_id: string
          requester_id: string
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_id: string
          requester_id: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_id?: string
          requester_id?: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      genres: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
        }
        Relationships: []
      }
      instruments: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "media_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_posts: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          media_url: string
          profile_id: string
          status: string
          tags: string[] | null
          thumbnail_url: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
          media_url: string
          profile_id: string
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          media_url?: string
          profile_id?: string
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_posts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_genres: {
        Row: {
          genre_id: number
          profile_id: string
        }
        Insert: {
          genre_id: number
          profile_id: string
        }
        Update: {
          genre_id?: number
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_genres_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_highlights: {
        Row: {
          created_at: string
          position: number
          post_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          position: number
          post_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          position?: number
          post_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_highlights_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "media_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_highlights_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_instruments: {
        Row: {
          instrument_id: number
          profile_id: string
          skill_level: Database["public"]["Enums"]["experience_level"]
        }
        Insert: {
          instrument_id: number
          profile_id: string
          skill_level?: Database["public"]["Enums"]["experience_level"]
        }
        Update: {
          instrument_id?: number
          profile_id?: string
          skill_level?: Database["public"]["Enums"]["experience_level"]
        }
        Relationships: [
          {
            foreignKeyName: "profile_instruments_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_instruments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          availability_statuses: Database["public"]["Enums"]["availability_status"][]
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          experience_level:
            | Database["public"]["Enums"]["experience_level"]
            | null
          id: string
          intro_media_type: Database["public"]["Enums"]["media_type"] | null
          intro_media_url: string | null
          location_city: string | null
          location_state: string | null
          matched_city_id: string | null
          updated_at: string
          username: string
        }
        Insert: {
          availability_statuses?: Database["public"]["Enums"]["availability_status"][]
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          experience_level?:
            | Database["public"]["Enums"]["experience_level"]
            | null
          id: string
          intro_media_type?: Database["public"]["Enums"]["media_type"] | null
          intro_media_url?: string | null
          location_city?: string | null
          location_state?: string | null
          matched_city_id?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          availability_statuses?: Database["public"]["Enums"]["availability_status"][]
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          experience_level?:
            | Database["public"]["Enums"]["experience_level"]
            | null
          id?: string
          intro_media_type?: Database["public"]["Enums"]["media_type"] | null
          intro_media_url?: string | null
          location_city?: string | null
          location_state?: string | null
          matched_city_id?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_matched_city_id_fkey"
            columns: ["matched_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          expo_push_token: string
          id: string
          platform: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expo_push_token: string
          id?: string
          platform: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expo_push_token?: string
          id?: string
          platform?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dev_confirm_user_email: { Args: { user_id: string }; Returns: undefined }
      discover_profiles: {
        Args: {
          genre_ids?: number[]
          instrument_ids?: number[]
          page_limit?: number
          page_offset?: number
          radius_miles?: number
        }
        Returns: {
          avatar_url: string
          display_name: string
          distance_miles: number
          genres: Json
          id: string
          instruments: Json
          location_city: string
          location_state: string
          username: string
        }[]
      }
      get_push_webhook_secret: { Args: never; Returns: string }
      reorder_profile_highlights: {
        Args: { p_post_ids: string[] }
        Returns: undefined
      }
    }
    Enums: {
      availability_status:
        | "looking_for_band"
        | "available_for_session_work"
        | "open_to_auditions"
        | "forming_band"
        | "open_to_collabs"
        | "not_currently_looking"
      connection_status: "pending" | "accepted" | "declined"
      experience_level:
        | "beginner"
        | "intermediate"
        | "advanced"
        | "professional"
      media_type: "image" | "audio" | "video"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      availability_status: [
        "looking_for_band",
        "available_for_session_work",
        "open_to_auditions",
        "forming_band",
        "open_to_collabs",
        "not_currently_looking",
      ],
      connection_status: ["pending", "accepted", "declined"],
      experience_level: [
        "beginner",
        "intermediate",
        "advanced",
        "professional",
      ],
      media_type: ["image", "audio", "video"],
    },
  },
} as const
