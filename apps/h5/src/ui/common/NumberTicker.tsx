import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

export function NumberTicker({ value, className }: { value: bigint | number; className?: string }) {
    const numericValue = typeof value === 'bigint' ? Number(value) : value;
    const [displayValue, setDisplayValue] = useState(numericValue);
    const obj = useRef({ val: numericValue });
    const prevValue = useRef(numericValue);

    useEffect(() => {
        if (prevValue.current === numericValue) return;

        gsap.to(obj.current, {
            val: numericValue,
            duration: 1.2,
            ease: 'power2.out',
            onUpdate: () => {
                setDisplayValue(Math.floor(obj.current.val));
            },
        });
        prevValue.current = numericValue;
    }, [numericValue]);

    return <span className={className}>{displayValue.toLocaleString()}</span>;
}
