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
      audit_events: {
        Row: {
          actor: string
          created_at: string
          detail: string
          event: string
          event_code: string
          id: string
          incident_code: string | null
          metadata: Json
          occurred_at: string
          outcome: string
          stage: string
        }
        Insert: {
          actor: string
          created_at?: string
          detail: string
          event: string
          event_code: string
          id?: string
          incident_code?: string | null
          metadata?: Json
          occurred_at: string
          outcome: string
          stage: string
        }
        Update: {
          actor?: string
          created_at?: string
          detail?: string
          event?: string
          event_code?: string
          id?: string
          incident_code?: string | null
          metadata?: Json
          occurred_at?: string
          outcome?: string
          stage?: string
        }
        Relationships: []
      }
      dashboard_snapshot: {
        Row: {
          id: number
          payload: Json
          refreshed_at: string
        }
        Insert: {
          id?: number
          payload: Json
          refreshed_at?: string
        }
        Update: {
          id?: number
          payload?: Json
          refreshed_at?: string
        }
        Relationships: []
      }
      dataset_meta: {
        Row: {
          as_of: string
          generated_at: string
          generator_version: string
          id: number
          merchant_id: string
          merchant_name: string
          seed: string
          transaction_count: number
          window_start: string
        }
        Insert: {
          as_of: string
          generated_at?: string
          generator_version: string
          id?: number
          merchant_id: string
          merchant_name: string
          seed: string
          transaction_count?: number
          window_start: string
        }
        Update: {
          as_of?: string
          generated_at?: string
          generator_version?: string
          id?: number
          merchant_id?: string
          merchant_name?: string
          seed?: string
          transaction_count?: number
          window_start?: string
        }
        Relationships: []
      }
      incident_reports: {
        Row: {
          incident_code: string
          payload: Json
          refreshed_at: string
        }
        Insert: {
          incident_code: string
          payload: Json
          refreshed_at?: string
        }
        Update: {
          incident_code?: string
          payload?: Json
          refreshed_at?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          affected_transactions: number
          attempted_transactions: number
          baseline_success_rate: number
          confidence: number | null
          created_at: string
          detected_at: string
          detection_params: Json
          detection_rule: string
          diagnosis: string | null
          dominant_failure_reason: string | null
          dominant_failure_share: number | null
          drop_pct: number
          drop_pp: number
          id: string
          incident_code: string
          metric: string
          natural_key: string
          observed_success_rate: number
          resolved_at: string | null
          revenue_at_risk_paise: number
          revenue_recovered_paise: number
          root_cause: string | null
          scope_issuer: string | null
          scope_label: string
          scope_method: string | null
          scope_type: string
          severity: string
          status: string
          title: string
          updated_at: string
          window_end: string
          window_start: string
          z_score: number
        }
        Insert: {
          affected_transactions?: number
          attempted_transactions?: number
          baseline_success_rate: number
          confidence?: number | null
          created_at?: string
          detected_at: string
          detection_params?: Json
          detection_rule: string
          diagnosis?: string | null
          dominant_failure_reason?: string | null
          dominant_failure_share?: number | null
          drop_pct: number
          drop_pp: number
          id?: string
          incident_code: string
          metric?: string
          natural_key: string
          observed_success_rate: number
          resolved_at?: string | null
          revenue_at_risk_paise?: number
          revenue_recovered_paise?: number
          root_cause?: string | null
          scope_issuer?: string | null
          scope_label: string
          scope_method?: string | null
          scope_type: string
          severity: string
          status: string
          title: string
          updated_at?: string
          window_end: string
          window_start: string
          z_score: number
        }
        Update: {
          affected_transactions?: number
          attempted_transactions?: number
          baseline_success_rate?: number
          confidence?: number | null
          created_at?: string
          detected_at?: string
          detection_params?: Json
          detection_rule?: string
          diagnosis?: string | null
          dominant_failure_reason?: string | null
          dominant_failure_share?: number | null
          drop_pct?: number
          drop_pp?: number
          id?: string
          incident_code?: string
          metric?: string
          natural_key?: string
          observed_success_rate?: number
          resolved_at?: string | null
          revenue_at_risk_paise?: number
          revenue_recovered_paise?: number
          root_cause?: string | null
          scope_issuer?: string | null
          scope_label?: string
          scope_method?: string | null
          scope_type?: string
          severity?: string
          status?: string
          title?: string
          updated_at?: string
          window_end?: string
          window_start?: string
          z_score?: number
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_paise: number
          auth_latency_ms: number
          city: string
          created_at: string
          currency: string
          customer_ref: string
          customer_type: string
          device_type: string
          failure_category: string | null
          failure_reason: string | null
          gateway_response_code: string | null
          id: number
          is_retry: boolean
          issuer: string
          method_detail: string
          occurred_at: string
          parent_transaction_id: string | null
          payment_method: string
          payment_status: string
          psp: string
          region: string
          retry_count: number
          scenario_tag: string
          transaction_id: string
        }
        Insert: {
          amount_paise: number
          auth_latency_ms: number
          city: string
          created_at?: string
          currency?: string
          customer_ref: string
          customer_type: string
          device_type: string
          failure_category?: string | null
          failure_reason?: string | null
          gateway_response_code?: string | null
          id?: never
          is_retry?: boolean
          issuer: string
          method_detail: string
          occurred_at: string
          parent_transaction_id?: string | null
          payment_method: string
          payment_status: string
          psp: string
          region: string
          retry_count?: number
          scenario_tag?: string
          transaction_id: string
        }
        Update: {
          amount_paise?: number
          auth_latency_ms?: number
          city?: string
          created_at?: string
          currency?: string
          customer_ref?: string
          customer_type?: string
          device_type?: string
          failure_category?: string | null
          failure_reason?: string | null
          gateway_response_code?: string | null
          id?: never
          is_retry?: boolean
          issuer?: string
          method_detail?: string
          occurred_at?: string
          parent_transaction_id?: string | null
          payment_method?: string
          payment_status?: string
          psp?: string
          region?: string
          retry_count?: number
          scenario_tag?: string
          transaction_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      revive_base_sr: {
        Args: {
          p_amount: number
          p_customer: string
          p_detail: string
          p_device: string
          p_issuer: string
        }
        Returns: number
      }
      revive_between: {
        Args: { p_hi: number; p_key: string; p_lo: number }
        Returns: number
      }
      revive_build_incident_report: { Args: { p_code: string }; Returns: Json }
      revive_detect_incidents: { Args: never; Returns: Json }
      revive_failure_category: { Args: { p_reason: string }; Returns: string }
      revive_generate_dataset: { Args: never; Returns: Json }
      revive_method_label: { Args: { p_method: string }; Returns: string }
      revive_pick: {
        Args: { p_key: string; p_values: string[]; p_weights: number[] }
        Returns: string
      }
      revive_rand: { Args: { p_key: string }; Returns: number }
      revive_reason_label: { Args: { p_reason: string }; Returns: string }
      revive_refresh_projections: { Args: never; Returns: Json }
      revive_region: { Args: { p_city: string }; Returns: string }
      revive_response_code: { Args: { p_reason: string }; Returns: string }
      revive_scenario: {
        Args: {
          p_detail: string
          p_issuer: string
          p_method: string
          p_psp: string
          p_ts: string
        }
        Returns: Database["public"]["CompositeTypes"]["revive_scenario_effect"]
        SetofOptions: {
          from: "*"
          to: "revive_scenario_effect"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revive_severity: {
        Args: { p_at_risk_paise: number; p_drop_pp: number }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      revive_scenario_effect: {
        tag: string | null
        severity: number | null
        impact: number | null
        failure_reason: string | null
        reason_share: number | null
        latency_multiplier: number | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
