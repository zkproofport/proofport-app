//! Oracle for the app's OPRF node client (src/oprf/wire.ts, src/oprf/shamir.ts):
//! the node network's own Rust types (taceo-oprf-types 0.16.2) serialized with
//! the CBOR library its client uses (ciborium 0.2), and its own Shamir
//! combination and Chaum-Pedersen code (taceo-oprf-core 0.6.3), seeded so the
//! output is the same on every run. Three 2-of-3 cases over different party
//! pairs and epochs. Run by scripts/generate-oprf-wire-vectors.sh, which writes
//! src/oprf/__tests__/fixtures/oprf-wire-vectors.json. Cargo.lock is the one
//! proofport-oprf builds with, so `cargo build --offline` resolves the same
//! crate versions.
use ark_ec::{AffineRepr, CurveGroup};
use ark_ff::UniformRand;
use rand::SeedableRng;
use serde::Serialize;
use taceo_oprf_core::ddlog_equality::shamir::{DLogCommitmentsShamir, DLogSessionShamir, DLogShareShamir};
use taceo_oprf_core::shamir;
use taceo_oprf_types::api::{OprfPublicKeyWithEpoch, OprfRequest, OprfResponse};
use taceo_oprf_types::crypto::{OprfPublicKey, PartyId};
use taceo_oprf_types::ShareEpoch;

type Fr = ark_babyjubjub::Fr;
type Affine = ark_babyjubjub::EdwardsAffine;

#[derive(Clone, Serialize)]
struct BasicAuth { api_key: String }

fn cbor<T: Serialize>(v: &T) -> String {
    let mut buf = Vec::new();
    ciborium::into_writer(v, &mut buf).unwrap();
    buf.iter().map(|b| format!("{b:02x}")).collect()
}
fn js<T: Serialize>(v: &T) -> serde_json::Value { serde_json::to_value(v).unwrap() }
fn pt(p: &Affine) -> serde_json::Value { serde_json::json!([p.x.to_string(), p.y.to_string()]) }

fn case(seed: u64, used_ids: &[u16], epoch: u32) -> serde_json::Value {
    let mut rng = rand_chacha::ChaCha20Rng::seed_from_u64(seed);
    let k = Fr::rand(&mut rng);
    let a1 = Fr::rand(&mut rng);
    // degree-1 Shamir over parties 1..=3
    let shares: Vec<Fr> = (1u64..=3).map(|i| k + a1 * Fr::from(i)).collect();
    let d = (Affine::generator() * k).into_affine();
    let blinded = (Affine::generator() * Fr::rand(&mut rng)).into_affine();
    let session_id = uuid::Uuid::from_bytes(rand::Rng::r#gen(&mut rng));
    let contributing: Vec<u16> = used_ids.iter().map(|i| i + 1).collect();
    let mut sessions = Vec::new();
    let mut comms = Vec::new();
    let mut responses = Vec::new();
    for &pid in used_ids {
        let (s, c) = DLogSessionShamir::partial_commitments(blinded, DLogShareShamir::from(shares[pid as usize]), &mut rng);
        let resp = OprfResponse { commitments: c.clone(), party_id: PartyId(pid), oprf_pub_key_with_epoch: OprfPublicKeyWithEpoch { key: OprfPublicKey::new(d), epoch: ShareEpoch::new(epoch) } };
        responses.push(serde_json::json!({"party_id": pid, "commitments": js(&c), "cbor": cbor(&resp)}));
        sessions.push((pid, s));
        comms.push(c);
    }
    let challenge = DLogCommitmentsShamir::combine_commitments(&comms, contributing.clone());
    let mut shares_out = Vec::new();
    let mut proofs = Vec::new();
    for (pid, s) in sessions {
        let l = shamir::single_lagrange_from_coeff(pid + 1, &contributing);
        let p = s.challenge(session_id, DLogShareShamir::from(shares[pid as usize]), d, challenge.clone(), l);
        shares_out.push(serde_json::json!({"party_id": pid, "share": js(&p), "cbor": cbor(&p)}));
        proofs.push(p);
    }
    let proof = challenge.clone().combine_proofs(session_id, &proofs, d, blinded);
    proof.verify(d, blinded, challenge.blinded_response(), Affine::generator()).expect("verifies");
    let req = OprfRequest { request_id: session_id, blinded_query: blinded, auth: BasicAuth { api_key: "taceo_test".into() } };
    serde_json::json!({
        "seed": seed, "used_party_ids": used_ids, "epoch": epoch,
        "session_id": session_id.to_string(),
        "public_key": pt(&d), "blinded_query": pt(&blinded),
        "secret_key": k.to_string(),
        "responses": responses,
        "challenge": js(&challenge), "challenge_cbor": cbor(&challenge),
        "proof_shares": shares_out,
        "blinded_response": pt(&challenge.blinded_response()),
        "e": proof.e().to_string(), "s": proof.s().to_string(),
        "request_cbor": cbor(&req),
    })
}

fn main() {
    let out = serde_json::json!({
        "generator": "oprf-wire-oracle (taceo-oprf-core 0.6.3, taceo-oprf-types 0.16.2, ciborium 0.2)",
        "cases": [case(1, &[0, 1], 0), case(2, &[0, 2], 3), case(3, &[1, 2], 4294967295)],
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
