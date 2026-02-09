import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

export function NumberTicker({ value, className }: { value: bigint | number; className?: string }) {
    const numericValue = typeof value === 'bigint' ? Number(value) : value;
    const [displayValue, setDisplayValue] = useState(numericValue);
    const obj = useRef({ val: numericValue });

    useEffect(() => {
        gsap.to(obj.current, {
            val: numericValue,
            duration: 0.8,
            ease: 'power3.out',
            onUpdate: () => {
                setDisplayValue(Math.floor(obj.current.val));
            },
        });
    }, [numericValue]);

    return <span className={className}>{displayValue.toLocaleString()}</span>;
}
