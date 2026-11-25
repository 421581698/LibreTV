use std::{env, fs, process};

use dolby_vision::rpu::dovi_rpu::DoviRpu;

fn main() {
    if let Err(error) = run() {
        eprintln!("AV1 T.35 RPU conversion failed: {error:#}");
        process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    let mut args = env::args().skip(1);
    let input = args.next().ok_or_else(|| anyhow::anyhow!("missing input path"))?;
    let output = args.next().ok_or_else(|| anyhow::anyhow!("missing output path"))?;
    let reference = args.next();
    if args.next().is_some() {
        anyhow::bail!("unexpected extra arguments");
    }

    let payload = fs::read(input)?;
    let parsed = DoviRpu::parse_itu_t35_dovi_metadata_obu(&payload)?;
    if let Some(reference_path) = reference {
        // Match dovi_tool's own AV1 fixture contract: upstream reference is
        // Annex-B (4-byte start code + 2-byte HEVC NAL header), while the
        // serializer returns the HEVC NAL unit without the start code.
        let expected = fs::read(reference_path)?;
        let serialized = parsed.write_hevc_unspec62_nalu()?;
        if expected.get(4..) != serialized.get(2..) {
            anyhow::bail!("AV1 T.35 RPU does not match the upstream HEVC RPU reference");
        }
    }
    let profile = parsed.dovi_profile;
    let rpu = parsed.write_rpu()?;
    let last_nonzero = rpu.iter().rposition(|byte| *byte != 0);
    if rpu.len() < 25 || rpu.first().copied() != Some(0x19) ||
        last_nonzero.map(|index| rpu[index]) != Some(0x80) {
        anyhow::bail!("libdovi returned an invalid regular RPU buffer");
    }
    fs::write(output, &rpu)?;
    println!(
        "{{\"profile\":{profile},\"rpuByteLength\":{}}}",
        rpu.len()
    );
    Ok(())
}
