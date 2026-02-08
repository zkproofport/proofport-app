# ZKProofport UI Component Library

A comprehensive, production-ready UI component library following atomic design principles.

## Structure

```
ui/
├── atoms/         - Basic building blocks
├── molecules/     - Simple component combinations
├── organisms/     - Complex UI patterns
└── index.ts       - Central export point
```

## Design System

### Color Palette
- **Background**: `#0F1419` (primary), `#1A2332` (card), `#232D3F` (hover)
- **Text**: `#FFFFFF` (primary), `#9CA3AF` (secondary), `#6B7280` (muted)
- **Border**: `#2D3748` (primary)
- **Accent**: `#3B82F6` (blue), `#10B981` (success), `#F59E0B` (warning), `#EF4444` (error)

### Spacing
- Border radius: `16px` (cards), `12px` (buttons), `24px` (modals)
- Padding: `16px` (standard card padding)

## Components

### Atoms

#### Icon
```tsx
import {Icon} from '@/components/ui';

<Icon name="check" size="md" color="#10B981" />
```

#### Badge
```tsx
import {Badge} from '@/components/ui';

<Badge variant="success" text="Verified" />
<Badge variant="warning" text="Pending" />
<Badge variant="error" text="Failed" />
```

#### Divider
```tsx
import {Divider} from '@/components/ui';

<Divider />
<Divider label="OR" />
```

### Molecules

#### Button
```tsx
import {Button} from '@/components/ui';

<Button
  title="Connect Wallet"
  onPress={handleConnect}
  variant="primary"
  size="large"
/>

<Button
  title="Cancel"
  onPress={handleCancel}
  variant="secondary"
/>

<Button
  title="Processing..."
  onPress={() => {}}
  loading={true}
  disabled={true}
/>
```

#### Card
```tsx
import {Card} from '@/components/ui';

<Card>
  <Text>Card content</Text>
</Card>

<Card onPress={handlePress}>
  <Text>Touchable card</Text>
</Card>
```

#### MenuItem
```tsx
import {MenuItem} from '@/components/ui';

<MenuItem
  icon="settings"
  title="Settings"
  subtitle="Manage your preferences"
  onPress={handlePress}
/>
```

#### Toggle
```tsx
import {Toggle} from '@/components/ui';

<Toggle
  value={enabled}
  onValueChange={setEnabled}
  label="Enable notifications"
/>
```

### Organisms

#### StepIndicator
```tsx
import {StepIndicator, mapHookStepsToUserSteps} from '@/components/ui';

const steps = [
  {id: 'generate_vk', icon: 'key', label: 'Generate Key', status: 'complete'},
  {id: 'generate_proof', icon: 'cpu', label: 'Generate Proof', status: 'active'},
  {id: 'verify_proof', icon: 'check-circle', label: 'Verify', status: 'pending'},
];

<StepIndicator steps={steps} />

// Or map from hook steps
const userSteps = mapHookStepsToUserSteps(hookSteps);
<StepIndicator steps={userSteps} />
```

#### LiveLogsPanel
```tsx
import {LiveLogsPanel} from '@/components/ui';

<LiveLogsPanel
  logs={logs}
  autoScroll={true}
  maxHeight={300}
/>
```

#### CircuitCard
```tsx
import {CircuitCard} from '@/components/ui';

<CircuitCard
  icon="shield"
  title="Coinbase KYC"
  description="Prove Coinbase attestation without revealing identity"
  onPress={handleSelect}
/>

```

#### WalletCard
```tsx
import {WalletCard} from '@/components/ui';

<WalletCard
  walletIcon="wallet"
  walletName="MetaMask"
  address="0x1234...5678"
  network="Ethereum Mainnet"
  brandColor="#F6851B"
  isActive={true}
  onDisconnect={handleDisconnect}
/>
```

#### ProofHistoryCard
```tsx
import {ProofHistoryCard} from '@/components/ui';

<ProofHistoryCard
  circuitIcon="shield"
  circuitName="Coinbase KYC"
  status="verified"
  date="2024-01-29 14:23"
  network="Ethereum Mainnet"
  proofHash="0xabcd...ef01"
  onPress={handleViewDetails}
/>
```

## Usage Example

```tsx
import React from 'react';
import {View, ScrollView} from 'react-native';
import {
  Button,
  Card,
  CircuitCard,
  StepIndicator,
  LiveLogsPanel,
} from '@/components/ui';

export const ProofScreen = () => {
  const [logs, setLogs] = React.useState([]);
  const [steps, setSteps] = React.useState([
    {id: '1', icon: 'key', label: 'Generate Key', status: 'complete'},
    {id: '2', icon: 'cpu', label: 'Generate Proof', status: 'active'},
    {id: '3', icon: 'check-circle', label: 'Verify', status: 'pending'},
  ]);

  return (
    <ScrollView style={{flex: 1, backgroundColor: '#0F1419'}}>
      <Card style={{margin: 16}}>
        <StepIndicator steps={steps} />
      </Card>

      <Card style={{margin: 16}}>
        <LiveLogsPanel logs={logs} maxHeight={200} />
      </Card>

      <Button
        title="Generate Proof"
        onPress={handleGenerateProof}
        variant="primary"
        size="large"
        style={{margin: 16}}
      />
    </ScrollView>
  );
};
```

## Customization

All components accept a `style` prop for custom styling. The design system colors are intentionally bold and cohesive - maintain consistency when extending.
