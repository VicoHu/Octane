import React, { useContext } from 'react';
import { OTPInputContext } from 'input-otp';
import { InputOTP, InputOTPGroup } from '@/components/ui/input-otp';
import { cn } from '@/lib/utils';

interface PinCodeInputProps {
  id?: string;
  /** 格数(4 或 6) */
  length: number;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * 掩码分格 PIN 输入(#96):每位一格方框,输入自动跳格、退格回退、支持整段粘贴。
 *
 * 掩码在显示层实现:slot 有值时渲染圆点而非明文(input-otp 1.5 无 mask prop)。
 * 必须用 children 模式组合——input-otp 的 render prop 分支不包 Context Provider,
 * 依赖 OTPInputContext 的 slot 组件在 render 模式下会拿到空 context 崩溃。
 */
export function PinCodeInput({
  id,
  length,
  value,
  onChange,
  autoFocus,
  onKeyDown,
  ...rest
}: PinCodeInputProps) {
  return (
    <InputOTP
      id={id}
      maxLength={length}
      inputMode="numeric"
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      aria-label={rest['aria-label']}
      aria-invalid={rest['aria-invalid']}
      // 容器占满父宽,分格组水平居中(弹窗内容整体居中布局,靠左会显歪)
      containerClassName="justify-center"
    >
      <InputOTPGroup>
        {Array.from({ length }).map((_, i) => (
          <MaskedPinSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

/** 掩码格:样式与 ui/input-otp 的 InputOTPSlot 一致,仅把明文 char 显示为圆点 */
function MaskedPinSlot({ index, className }: { index: number; className?: string }) {
  const ctx = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = ctx?.slots[index] ?? {};

  return (
    <div
      data-slot="pin-code-slot"
      data-active={isActive}
      className={cn(
        'relative flex size-10 items-center justify-center border-y border-r border-input text-sm shadow-xs transition-all outline-none first:rounded-l-md first:border-l last:rounded-r-md data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/50 dark:bg-input/30',
        className,
      )}
    >
      {char ? '•' : null}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
}
